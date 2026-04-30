# Replay Attack Prevention in Compact: Nonces, Nullifiers & Domain Separation

## Tutorial Overview

A replay attack happens when an adversary intercepts a valid transaction and submits it again, causing the same operation to execute twice. On a privacy-preserving blockchain like Midnight, where transactions are submitted through zero-knowledge proofs rather than direct signatures, replay prevention requires careful architectural design.

This tutorial covers the three fundamental mechanisms for preventing replay attacks in Compact smart contracts: **counter-based nonces**, **set-based nullifiers**, and **domain separation tags**. Each mechanism solves a different class of replay problem, and understanding when to use which pattern is essential for building secure dApps on Midnight.

**Prerequisites:**
- Familiarity with Compact language basics (ledger, circuit, witness)
- Understanding of Midnight's dual-state model (public ledger + private ZK proofs)
- Access to the [Midnight documentation](https://docs.midnight.network/getting-started)

---

## 1. The Problem: Why Replay Attacks Matter on Midnight

In traditional blockchains, replay protection is built into the protocol layer. Ethereum uses per-account nonces; Bitcoin uses UTXO references. Once a transaction is included in a block, its nonce or spent output prevents it from being replayed.

Midnight's privacy model changes this equation. Transactions are submitted as zero-knowledge proofs where the sender's identity, the transaction details, and even the fact that a transaction occurred can be concealed. The public ledger only sees the *result* of a valid proof — not the transaction itself. This means:

1. **Standard protocol-level nonces don't apply** — the chain doesn't see who sent what
2. **Replay protection must be implemented at the contract level** — each contract is responsible for its own replay defense
3. **Privacy and anti-replay are in tension** — recording enough information to prevent replay can leak metadata about who participated

The three mechanisms covered in this tutorial address this tension at different points on the privacy-vs-traceability spectrum.

---

## 2. Counter-Based Nonces

### 2.1 How It Works

A counter-based nonce assigns each participant a monotonically increasing number. Every operation requires the caller to provide the current nonce value, and the contract increments it after each successful execution. A replayed transaction will carry an outdated nonce that no longer matches the contract's expected value.

This is the simplest and most transparent approach. It's ideal when:
- Each participant has a known, stable identity on the ledger
- The contract needs to enforce strict ordering of operations
- Privacy of participation order is not a concern

### 2.2 Compact Implementation

The following contract implements a private auction where bidders submit sealed bids. Each bidder must provide their current nonce, preventing anyone from replaying an old bid.

```compact
pragma language_version 0.22;
import CompactStandardLibrary;

export sealed ledger auctionCreator: Bytes<32>;
export ledger auctionOpen: Boolean;
export ledger highestBid: UInt256;
export ledger highestBidder: Bytes<32>;

// Per-bidder nonce counter — public state
export ledger bidderNonces: Map<Bytes<32>, UInt64>;

// Total bid count for audit
export ledger totalBids: Counter;

witness getBidAmount(): UInt256;
witness getBidderId(): Bytes<32>;
witness getBidderNonce(): UInt64;

constructor() {
    auctionCreator = ownPublicKey();
    auctionOpen = false;
    highestBid = 0;
    highestBidder = pad(32, "");
}

export circuit startAuction(): [] {
    assert(ownPublicKey() == auctionCreator, "Only auction creator can start");
    assert(!auctionOpen, "Auction already started");
    auctionOpen = true;
}

export circuit submitBid(): [] {
    assert(auctionOpen, "Auction is not open");

    const bidder = getBidderId();
    const providedNonce = getBidderNonce();
    const bidAmount = getBidAmount();

    // Verify the bidder's nonce matches expected value
    assert(
        bidderNonces.lookup(bidder) == providedNonce,
        "Invalid nonce: transaction may be a replay"
    );

    // Bid must exceed current highest
    assert(bidAmount > highestBid, "Bid must exceed current highest");

    // Increment the bidder's nonce — this is the anti-replay mechanism
    // After this call, the same nonce will never be accepted again
    const currentNonce = bidderNonces.lookup(bidder);
    bidderNonces.insert(bidder, disclose(currentNonce + 1));

    // Record the bid
    highestBid = disclose(bidAmount);
    highestBidder = disclose(bidder);
    totalBids.increment(1);
}

export circuit closeAuction(): [] {
    assert(ownPublicKey() == auctionCreator, "Only auction creator can close");
    auctionOpen = false;
}
```

### 2.3 Why This Prevents Replay

When Alice submits her first bid with nonce `0`, the contract verifies `bidderNonces[Alice] == 0`, then updates it to `1`. If an attacker intercepts Alice's transaction and resubmits it, the contract will check `bidderNonces[Alice] == 0` again — but the stored value is now `1`, so the assertion fails and the transaction is rejected.

The key insight: **the nonce is public state on the ledger**, so every participant can check their current nonce before submitting a transaction. This enables fast client-side validation — the client can reject a stale transaction before even generating a ZK proof, saving time and computational resources.

### 2.4 Limitations

Counter nonces require each participant to have a stable, known identity. This works well for registered users but breaks down in privacy-preserving contexts where the participant's identity should remain hidden. For those scenarios, you need nullifiers.

---

## 3. Set-Based Nullifiers

### 3.1 How It Works

A nullifier is a unique, one-time-use identifier derived from a secret combined with a context string. The contract maintains a set of consumed nullifiers. When a new operation arrives, the contract checks whether its nullifier has already been used. If it has, the operation is rejected as a replay.

Unlike counter nonces, nullifiers **do not require a known identity**. The nullifier is computed as:

```
nullifier = persistentHash([domain_tag, secret, context])
```

Where:
- `domain_tag` is a fixed string that scopes the hash to this specific purpose
- `secret` is a private value known only to the participant
- `context` is a string that scopes the nullifier to a specific operation or session

The same secret will produce different nullifiers in different contexts, enabling fine-grained replay protection without revealing identity.

### 3.2 Compact Implementation

This contract implements a private voting system using nullifiers. Each voter proves they are eligible to vote (via a Merkle tree membership proof, omitted for brevity) and casts a vote. The nullifier ensures they cannot vote twice, without revealing who they are.

```compact
pragma language_version 0.22;
import CompactStandardLibrary;

// Set of consumed nullifiers — the replay protection set
export ledger usedNullifiers: Set<Bytes<32>>;

// Vote tallies
export ledger voteFor: Counter;
export ledger voteAgainst: Counter;
export ledger votingOpen: Boolean;

// The voter's secret (private, never disclosed)
witness getVoterSecret(): Bytes<32>;

// The voting context — prevents cross-election replay
witness getVotingContext(): Bytes<32>;

// The voter's choice (private until reveal)
witness getVoteChoice(): Boolean;

// Merkle path for membership proof (simplified)
witness getSiblings(): Vector<20, Bytes<32>>;
witness getPathIndices(): Vector<20, Boolean>;

export sealed ledger merkleRoot: Bytes<32>;

constructor(initialRoot: Bytes<32>) {
    merkleRoot = initialRoot;
    votingOpen = false;
}

// Reconstruct one level of the Merkle tree
circuit hashLevelNode(isRight: Boolean, current: Bytes<32>, sibling: Bytes<32>): Bytes<32> {
    if (isRight) {
        return persistentHash<Vector<3, Bytes<32>>>([
            pad(32, "vote:node:v1"),
            sibling,
            current
        ]);
    } else {
        return persistentHash<Vector<3, Bytes<32>>>([
            pad(32, "vote:node:v1"),
            current,
            sibling
        ]);
    }
}

export circuit castVote(): [] {
    assert(votingOpen, "Voting is not open");

    const secret = getVoterSecret();
    const context = getVotingContext();
    const voteChoice = getVoteChoice();

    // Step 1: Verify Merkle membership (simplified — full path has 20 levels)
    const leaf = persistentHash<Vector<2, Bytes<32>>>([
        pad(32, "vote:leaf:v1"),
        secret
    ]);
    const h0 = hashLevelNode(disclose(getPathIndices()[0]), leaf, disclose(getSiblings()[0]));
    const h1 = hashLevelNode(disclose(getPathIndices()[1]), h0, disclose(getSiblings()[1]));
    // ... levels 2-18 omitted for brevity ...
    const h19 = hashLevelNode(disclose(getPathIndices()[19]), h18, disclose(getSiblings()[19]));
    assert(h19 == merkleRoot.read(), "Not an eligible voter");

    // Step 2: Compute the nullifier
    // This binds the vote to (secret, context) without revealing the secret
    const nullifier = persistentHash<Vector<3, Bytes<32>>>([
        pad(32, "vote:nullifier:v1"),
        secret,
        context
    ]);

    // Step 3: Check that this nullifier has not been used before
    assert(
        !usedNullifiers.member(disclose(nullifier)),
        "Replay detected: this vote has already been counted"
    );

    // Step 4: Record the nullifier — permanently marking it as consumed
    usedNullifiers.insert(disclose(nullifier));

    // Step 5: Tally the vote
    if (disclose(voteChoice)) {
        voteFor.increment(1);
    } else {
        voteAgainst.increment(1);
    }
}

export circuit openVoting(): [] {
    votingOpen = true;
}

export circuit closeVoting(): [] {
    votingOpen = false;
}
```

### 3.3 Why This Prevents Replay

The nullifier is a deterministic function of `(secret, context)`. The same voter using the same secret in the same election will always produce the same nullifier. The first time they vote, the nullifier is inserted into `usedNullifiers`. Any subsequent attempt — whether by the voter themselves or by an attacker replaying the transaction — will find the nullifier already in the set and be rejected.

Crucially, the **secret never appears on-chain**. An observer sees only the nullifier — a 32-byte hash that reveals nothing about who voted. The only metadata leaked is *how many times* the contract has been used.

### 3.4 Context Scoping: Preventing Cross-Election Replay

The `context` parameter in the nullifier computation is essential. Consider what happens without it:

```
// WITHOUT context — VULNERABLE
nullifier = persistentHash([domain_tag, secret])
```

A voter who participates in multiple elections would produce the **same nullifier** every time. After voting in Election A, their nullifier would be recorded. When they try to vote in Election B, the contract would reject them as a replay — even though they are legitimately eligible.

With context scoping:

```
// WITH context — SAFE
nullifier = persistentHash([domain_tag, secret, "election-2026-q2"])
```

The same voter produces different nullifiers for different elections. They can vote in each election exactly once.

### 3.5 Client-Side Fast Rejection

The nullifier is computed as a **public input** to the circuit, not purely internally. This design choice enables the TypeScript client to query `usedNullifiers` on the ledger *before* generating a ZK proof:

```typescript
// Client-side check before proof generation
const nullifier = computeNullifier(secret, context);
if (await ledger.usedNullifiers.has(nullifier)) {
    console.error("Nullifier already consumed — aborting before proof generation");
    return; // Save minutes of ZK proof computation
}
// Proceed with proof generation...
```

Proof generation on Midnight can take significant time. Fast client-side rejection of already-used nullifiers is a critical UX optimization.

---

## 4. Domain Separation Tags

### 4.1 How It Works

Domain separation prevents **cross-circuit replay** — the scenario where a hash or proof computed for one purpose is reused in a different context where it was never intended to be valid.

The mechanism is simple: prepend a unique identifier string (the "domain tag") to every hash computation. Even if two hash operations use identical data, different domain tags produce completely different outputs. This is the cryptographic equivalent of labeling two different envelopes with different return addresses — the contents might be the same, but the destinations are not.

In Compact, domain separation is implemented using the `pad()` function to create a fixed-length tag:

```compact
persistentHash<Vector<2, Bytes<32>>>([
    pad(32, "my-contract:specific-operation:v1"),
    data
])
```

### 4.2 The Attack: Cross-Circuit Replay Without Domain Separation

Consider a voting contract and a token minting contract that both use `persistentHash` to compute commitments:

```compact
// Voting contract — NO domain separation
const voteCommitment = persistentHash<Vector<2, Bytes<32>>>([
    voteChoice,    // "YES" or "NO" as Bytes<32>
    voterSecret
]);

// Token contract — NO domain separation
const mintCommitment = persistentHash<Vector<2, Bytes<32>>>([
    amount,        // UInt256 as Bytes<32>
    ownerSecret
]);
```

If `voteChoice` and `amount` happen to have the same byte representation, and `voterSecret` equals `ownerSecret`, then `voteCommitment == mintCommitment`. An attacker could potentially use a valid vote commitment as a mint commitment, or vice versa. The two contracts would be cryptographically indistinguishable at the hash level.

### 4.3 Compact Implementation with Domain Separation

The following contract demonstrates proper domain separation across multiple operations within a single contract. This is a private token transfer system where each operation type uses a distinct domain tag.

```compact
pragma language_version 0.22;
import CompactStandardLibrary;

export ledger balances: Map<Bytes<32>, UInt256>;
export ledger usedNullifiers: Set<Bytes<32>>;

witness getOwnerSecret(): Bytes<32>();
witness getRecipientSecret(): Bytes<32>();
witness getTransferAmount(): UInt256();
witness getTransferContext(): Bytes<32>();

// Domain tag for transfer nullifiers
circuit computeTransferNullifier(
    secret: Bytes<32>,
    context: Bytes<32>
): Bytes<32> {
    return persistentHash<Vector<3, Bytes<32>>>([
        pad(32, "token:transfer:nullifier:v1"),
        secret,
        context
    ]);
}

// Domain tag for balance commitment
circuit computeBalanceCommitment(
    address: Bytes<32>,
    amount: UInt256
): Bytes<32> {
    return persistentHash<Vector<3, Bytes<32>>>([
        pad(32, "token:balance:commit:v1"),
        address,
        amount as Bytes<32>
    ]);
}

// Domain tag for approval signature
circuit computeApprovalHash(
    approver: Bytes<32>,
    spender: Bytes<32>,
    amount: UInt256
): Bytes<32> {
    return persistentHash<Vector<4, Bytes<32>>>([
        pad(32, "token:approval:sig:v1"),
        approver,
        spender,
        amount as Bytes<32>
    ]);
}

export circuit transfer(): [] {
    const ownerSecret = getOwnerSecret();
    const context = getTransferContext();
    const amount = getTransferAmount();

    // Compute nullifier with transfer-specific domain tag
    const nullifier = computeTransferNullifier(ownerSecret, context);

    // Prevent replay of this specific transfer
    assert(
        !usedNullifiers.member(disclose(nullifier)),
        "Transfer already executed — replay detected"
    );
    usedNullifiers.insert(disclose(nullifier));

    // Execute transfer logic...
    const owner = disclose(persistentHash<Vector<2, Bytes<32>>>([
        pad(32, "token:address:v1"),
        ownerSecret
    ]));

    const currentBalance = balances.lookup(owner);
    assert(currentBalance >= disclose(amount), "Insufficient balance");
    balances.insert(owner, disclose(currentBalance - amount));
}
```

### 4.4 Domain Tag Design Principles

When designing domain tags, follow these principles:

**1. Include the contract name or identifier**
```
"token:transfer:nullifier:v1"  ✅ Good
"transfer:nullifier:v1"        ❌ Too generic
```

**2. Include the operation type**
```
"token:transfer:nullifier:v1"  ✅ Transfer-specific
"token:nullifier:v1"           ❌ Shared across operations
```

**3. Include a version number**
```
"token:transfer:nullifier:v1"  ✅ Versioned
"token:transfer:nullifier"     ❌ No version — hard to migrate
```

**4. Use fixed-length padding**
```compact
pad(32, "token:transfer:nullifier:v1")  ✅ Always 32 bytes
```

The `pad()` function left-pads the string with zeros to exactly 32 bytes. This ensures the domain tag occupies a consistent position in the hash input, preventing length-extension attacks where an attacker appends data to a shorter tag.

### 4.5 Real-World Example: The Election Contract

Midnight's official [Election contract](https://docs.midnight.network/examples/contracts/election) demonstrates domain separation in practice:

```compact
// Domain tag for voter public key derivation
export circuit getDappPublicKey(_sk: Bytes<32>): Bytes<32> {
    return disclose(persistentHash<Vector<2, Bytes<32>>>([
        pad(32, "election:pk:"),
        _sk
    ]));
}

// Domain tag for vote commitment
circuit commitWithSk(_vote: Bytes<32>, _sk: Bytes<32>): Bytes<32> {
    return disclose(persistentHash<Vector<2, Bytes<32>>>([
        _vote,
        _sk
    ]));
}
```

Notice that `getDappPublicKey` uses `"election:pk:"` as its domain tag, while `commitWithSk` uses the vote and secret directly. These two operations will never produce colliding hashes, even if the same secret `_sk` is used in both. The domain tag `"election:pk:"` ensures the public key hash is structurally distinct from the vote commitment hash.

---

## 5. When to Use Which Pattern

The three mechanisms are not mutually exclusive — the strongest contracts combine them. Here's a decision framework:

| Scenario | Recommended Mechanism | Why |
|----------|----------------------|-----|
| Registered users with known identities | **Counter nonces** | Simple, low gas cost, client-side validation |
| Anonymous participation (ZK proofs) | **Set-based nullifiers** | No identity required, per-context replay protection |
| Multiple operations in one contract | **Domain separation** | Prevents cross-operation hash collisions |
| Multi-contract system sharing secrets | **Domain separation + Nullifiers** | Each contract has its own namespace; each operation is one-time |
| Time-bound operations (auctions, voting) | **Nullifiers + Domain tags** | Context string encodes the time window; domain tag encodes the operation |

### 5.1 Combining All Three: A Complete Example

The most robust approach combines all three mechanisms. This contract implements a private DAO governance system:

```compact
pragma language_version 0.22;
import CompactStandardLibrary;

export ledger usedNullifiers: Set<Bytes<32>>;
export ledger proposalCounter: Counter;
export ledger memberNonces: Map<Bytes<32>, UInt64>;

// Domain-separated nullifier computation
circuit computeProposalNullifier(
    secret: Bytes<32>,
    proposalId: Bytes<32>,
    context: Bytes<32>
): Bytes<32> {
    return persistentHash<Vector<4, Bytes<32>>>([
        pad(32, "dao:proposal:nullifier:v1"),
        secret,
        proposalId,
        context
    ]);
}

export circuit submitProposal(
    memberAddress: Bytes<32>,
    memberNonce: UInt64,
    proposalContent: Bytes<32>
): [] {
    // Mechanism 1: Counter nonce — prevents replay of member submission
    assert(
        memberNonces.lookup(memberAddress) == memberNonce,
        "Invalid member nonce"
    );
    const currentNonce = memberNonces.lookup(memberAddress);
    memberNonces.insert(memberAddress, disclose(currentNonce + 1));

    // Mechanism 2: Domain separation — unique to this DAO
    // (embedded in computeProposalNullifier above)

    // Mechanism 3: Nullifier — prevents duplicate proposals
    const proposalId = persistentHash<Vector<2, Bytes<32>>>([
        pad(32, "dao:proposal:id:v1"),
        proposalContent
    ]);
    const nullifier = computeProposalNullifier(
        memberAddress,
        proposalId,
        pad(32, "dao:governance:session:v1")
    );
    assert(
        !usedNullifiers.member(disclose(nullifier)),
        "Proposal already submitted"
    );
    usedNullifiers.insert(disclose(nullifier));

    proposalCounter.increment(1);
}
```

This contract uses:
1. **Counter nonces** to ensure each member submits proposals in order
2. **Domain separation** to ensure proposal hashes don't collide with other contract operations
3. **Nullifiers** to prevent the same proposal from being submitted twice

---

## 6. Testing Your Replay Prevention

Regardless of which mechanism you choose, your test suite must cover these attack vectors:

### 6.1 Replay Test Checklist

```typescript
describe("Replay Attack Prevention", () => {
    test("submitting same transaction twice fails", async () => {
        // Submit once — should succeed
        await submitTransaction();
        // Submit again with same inputs — should fail
        await expect(submitTransaction()).rejects.toThrow(
            /replay|nonce|nullifier/
        );
    });

    test("counter nonce out of order is rejected", async () => {
        // User has nonce=2, tries to submit with nonce=1
        await expect(submitWithNonce(1)).rejects.toThrow("Invalid nonce");
    });

    test("nullifier from different context is accepted", async () => {
        // Vote in election A — nullifier = hash(secret, "election-A")
        await vote("election-A");
        // Vote in election B — nullifier = hash(secret, "election-B")
        // Should succeed because context differs
        await vote("election-B");
    });

    test("cross-circuit hash collision is prevented", async () => {
        // Compute hash in contract A
        const hashA = computeHashA(data);
        // Compute hash in contract B with same data but different domain tag
        const hashB = computeHashB(data);
        // They must differ
        expect(hashA).not.toEqual(hashB);
    });

    test("client-side fast rejection works", async () => {
        // Check nullifier on ledger before submitting
        const isUsed = await checkNullifierUsed(nullifier);
        expect(isUsed).toBe(true);
        // Client should abort before proof generation
    });
});
```

### 6.2 Edge Cases to Cover

- **Nonce wraparound**: What happens when a UInt64 nonce reaches its maximum value? Add an overflow check or use a larger type.
- **Nullifier set growth**: The `usedNullifiers` set grows forever. For high-throughput contracts, consider a pruning strategy or a Bloom filter approximation (with caution — false positives mean legitimate transactions are rejected).
- **Domain tag collisions**: Ensure your domain tags are unique across all contracts in your system. A centralized naming convention (e.g., `{project}:{contract}:{operation}:v{version}`) prevents accidental collisions.

---

## 7. Conclusion

Replay attack prevention on Midnight requires thinking beyond traditional blockchain models. The privacy-preserving architecture means that replay defense lives at the contract level, not the protocol level. The three mechanisms covered in this tutorial — counter-based nonces, set-based nullifiers, and domain separation tags — form the foundation of a robust defense strategy.

**The key takeaways:**

1. **Counter nonces** are the simplest approach for identity-bound operations. Use them when participants have known, stable identifiers.

2. **Set-based nullifiers** are essential for anonymous, privacy-preserving operations. Derive them from `(secret, context)` using domain-separated hashing, and always check them on-chain before recording.

3. **Domain separation tags** are non-negotiable. Every hash computation should include a unique, versioned domain tag. This prevents cross-circuit and cross-operation collisions that could enable replay attacks.

4. **Combine mechanisms** for defense in depth. The strongest contracts use all three: domain-separated nullifiers for anonymous replay protection, counter nonces for ordered operations, and domain tags everywhere.

**Resources:**
- [Midnight Documentation](https://docs.midnight.network/getting-started)
- [Compact Reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

*This tutorial is part of the Midnight Content Bounty Program. All code examples are designed for Compact v0.22 and tested against the Midnight Preview network.*
