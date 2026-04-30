# Designing Public vs. Private State in Compact: A Practical Decision Framework

## Introduction

When building smart contracts on Midnight, one of the most critical architectural decisions you'll make is **what data lives on the public ledger versus what stays in private state**. This isn't just a privacy concern — it affects proof size, gas costs, user experience, and whether your protocol is even secure.

Get it wrong in one direction and you leak data you promised to keep private. Get it wrong in the other direction and your contract becomes unusable because clients can't reconstruct enough state to generate proofs.

This tutorial provides a **practical decision framework** with real Compact code examples, covering:

- **Exported vs non-exported ledger fields** and when to use each
- **`disclose()` implications** — what it reveals and what it doesn't
- **Shielded vs unshielded token choices** and their trade-offs
- **Common privacy leaks** (Merkle paths, intermediate values, correlatable data)
- **Decision trees** for common dApp patterns

## The Midnight State Model

Midnight uses a **three-part architecture**:

1. **Public Ledger State** — On-chain data visible to all nodes
2. **Private State** — Off-chain data held by individual users
3. **ZK Proofs** — Cryptographic bridges between private computation and public verification

```
┌─────────────────────────────────────────────────────────┐
│                    Midnight Contract                      │
│                                                           │
│  ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │  Public Ledger  │◄──►│       ZK Circuits           │  │
│  │  (On-chain)     │    │  (Prove correctness,        │  │
│  │                 │    │   hide private data)        │  │
│  │  - Merkle roots │    │                             │  │
│  │  - Nullifier sets│   │                             │  │
│  │  - Nonces       │    │                             │  │
│  │  - Aggregate    │    │                             │  │
│  │    totals       │    │                             │  │
│  └─────────────────┘    └──────────┬──────────────────┘  │
│                                    │                      │
│                           ┌────────▼──────────────────┐  │
│                           │    Private State          │  │
│                           │    (Off-chain, per-user)  │  │
│                           │                           │  │
│                           │  - Token balances         │  │
│                           │  - Credential data        │  │
│                           │  - Identity attributes    │  │
│                           │  - Transaction history    │  │
│                           └───────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Part 1: Exported vs Non-Exported Ledger Fields

### Understanding `export` in Compact

In Compact, ledger fields can be declared with or without the `export` keyword:

```compact
// Exported: accessible from TypeScript API and JavaScript implementation
export ledger publicCounter: Counter;

// Non-exported: only accessible within Compact circuits
ledger internalState: Bytes<32>;
```

### When to Export

| Criteria | Export | Don't Export |
|----------|--------|--------------|
| TypeScript client needs to read it | ✅ | ❌ |
| Used for off-chain reconstruction | ✅ | ❌ |
| Needed for proof generation inputs | ✅ | ❌ |
| Internal circuit logic only | ❌ | ✅ |
| Sensitive intermediate values | ❌ | ✅ |
| Reduces attack surface | ❌ | ✅ |

### Real Example: Voting Contract

```compact
pragma language_version >= 0.22;
import CompactStandardLibrary;

// ✅ EXPORTED: Clients need to read the vote tally
export ledger voteTally: Map<Uint<8>, Uint<64>>;

// ✅ EXPORTED: Clients need to verify eligibility
export ledger eligibleVotersRoot: Bytes<32>;

// ❌ NOT EXPORTED: Internal nullifier tracking
// (clients don't need direct access; circuits handle it)
ledger nullifierSet: Set<Bytes<32>>;

// ❌ NOT EXPORTED: Internal epoch tracking
ledger epoch: Uint<32>;

export circuit castVote(
    witness voterSecret: Bytes<32>,
    witness merkleProof: MerkleTreePath<20, Bytes<32>>,
    public nullifier: Bytes<32>,
    public voteOption: Uint<8>
): [] {
    // Verify eligibility
    const computedRoot = merkleTreePathRoot<20, Bytes<32>>(merkleProof);
    assert(eligibleVotersRoot.checkRoot(disclose(computedRoot)), "Not eligible");
    
    // Verify nullifier hasn't been used
    assert(!nullifierSet.member(nullifier), "Already voted");
    
    // Record vote
    nullifierSet.insert(nullifier);
    voteTally.insert(voteOption, voteTally.lookup(voteOption) + 1);
}
```

### Key Insight

**Export only what TypeScript clients absolutely need.** Every exported field increases your contract's attack surface and makes it easier for observers to correlate data.

---

## Part 2: The `disclose()` Function — Implications and Pitfalls

### What `disclose()` Does

The `disclose()` function is Midnight's **privacy gate**. It explicitly marks private witness data for public exposure:

```compact
// Circuit parameters are private by default
export circuit transfer(
    witness senderBalance: Uint<64>,  // Private: only in ZK proof
    public amount: Uint<64>           // Public: visible on ledger
): [] {
    // To use senderBalance in a public ledger operation, you MUST disclose it
    const disclosedBalance = disclose(senderBalance);
    publicLedger.insert(senderAddress, disclosedBalance);
}
```

### What `disclose()` Reveals

| Input Type | After `disclose()` | Visible To |
|------------|-------------------|------------|
| Circuit parameter | Public ledger value | All network participants |
| Witness output | Public ledger value | All network participants |
| Hash of private data | Public hash value | All network participants |
| Commitment | Public commitment | All network participants (but can't reverse) |

### Common Mistake #1: Disclosing Merkle Paths

```compact
// ❌ BAD: Disclosing the entire Merkle path leaks your position in the tree
export circuit badAccess(
    witness merklePath: MerkleTreePath<20, Bytes<32>>
): [] {
    // This reveals which leaf you're proving membership for!
    const disclosedPath = disclose(merklePath);
    // An observer can reconstruct your leaf position from the path
}

// ✅ GOOD: Only disclose the computed root
export circuit goodAccess(
    witness merklePath: MerkleTreePath<20, Bytes<32>>
): [] {
    // Compute root from path (stays private)
    const computedRoot = merkleTreePathRoot<20, Bytes<32>>(merklePath);
    // Only the root is disclosed (proves membership without revealing position)
    assert(allowlist.checkRoot(disclose(computedRoot)), "Access denied");
}
```

### Common Mistake #2: Disclosing Intermediate Values

```compact
// ❌ BAD: Intermediate computation reveals private data
export circuit badProof(
    witness secretValue: Uint<64>,
    public result: Uint<64>
): [] {
    // If result = secretValue * 2, observers can compute secretValue = result / 2
    assert(result == secretValue * 2, "Invalid");
}

// ✅ GOOD: Use commitments for intermediate values
export circuit goodProof(
    witness secretValue: Uint<64>,
    witness rand: Field,
    public commitment: Field
): [] {
    // Commitment hides the value but binds to it
    const computedCommitment = transientCommit(secretValue, rand);
    assert(commitment == disclose(computedCommitment), "Commitment mismatch");
}
```

### Common Mistake #3: Disclosing Hashes of Guessable Values

```compact
// ❌ BAD: Hash of a small value space is brute-forceable
export circuit badLookup(
    witness secretId: Uint<16>,  // Only 65,536 possible values
    public hashedId: Bytes<32>
): [] {
    // Attacker can precompute hashes for all 65,536 values
    assert(hashedId == persistentHash(secretId), "Hash mismatch");
}

// ✅ GOOD: Use salted commitments for small value spaces
export circuit goodLookup(
    witness secretId: Uint<16>,
    witness salt: Bytes<32>,
    public saltedCommitment: Bytes<32>
): [] {
    // Salt makes brute-force infeasible
    const commitment = persistentCommit(secretId, salt);
    assert(saltedCommitment == disclose(commitment), "Commitment mismatch");
}
```

### Disclosure Hygiene Rules

Here's what we've learned from reading through a lot of Compact code:

- **Disclose late, not early.** If you're computing something from witness data and then immediately storing it on the ledger, wait until right before the store operation. This makes it obvious in code review exactly what's becoming public.
- **Prove facts, not values.** If you need to prove someone has at least 100 tokens, don't disclose their balance — use a range proof or commitment. The ledger only needs to know the proof passed, not the actual number.
- **Commitments beat hashes for small spaces.** If you're hashing a `Uint<16>` (65,536 possible values), an attacker can just precompute all hashes and reverse yours. `persistentCommit(value, salt)` with a random salt makes this infeasible.
- **Merkle paths are identity leaks.** A Merkle path reveals exactly which leaf you're proving membership for. Only the computed root should ever hit the public ledger — that's the whole point of the tree.
- **Intermediate values are easy to miss.** If your circuit computes `result = privateInput * 2` and then discloses `result`, anyone can divide by 2. This is the most common privacy leak we've seen in Compact contracts.

---

## Part 3: Shielded vs Unshielded Tokens

### Understanding the Token Model

Midnight supports two token models:

| Feature | Shielded Tokens | Unshielded Tokens |
|---------|----------------|-------------------|
| Balance visibility | Private (ZK-proof) | Public (ledger) |
| Transfer privacy | Hidden sender/receiver/amount | Visible to all |
| Proof complexity | Higher (ZK required) | Lower (direct) |
| Use case | Private payments, confidential DeFi | Public governance, transparent accounting |

### When to Use Shielded Tokens

```compact
// ✅ Shielded: Private payment system
export circuit shieldedTransfer(
    witness senderBalance: Uint<128>,
    witness senderSecret: Bytes<32>,
    witness merkleProof: MerkleTreePath<20, Bytes<32>>,
    public nullifier: Bytes<32>,
    public recipientCommitment: Bytes<32>,
    public amount: Uint<128>
): [] {
    // Verify sender has sufficient balance (private)
    assert(senderBalance >= amount, "Insufficient balance");
    
    // Verify nullifier prevents double-spend (public)
    assert(!nullifierSet.member(nullifier), "Already spent");
    
    // Record nullifier (public)
    nullifierSet.insert(nullifier);
    
    // Transfer is private: only nullifier and recipient commitment are public
}
```

### When to Use Unshielded Tokens

```compact
// ✅ Unshielded: Public governance token
export circuit unshieldedVote(
    public voterAddress: Bytes<32>,
    public voteAmount: Uint<128>,
    public voteOption: Uint<8>
): [] {
    // Balance is public — transparent governance
    assert(unshieldedBalanceGte(tokenColor, voteAmount), "Insufficient balance");
    
    // Record vote publicly
    voteTally.insert(voteOption, voteTally.lookup(voteOption) + voteAmount);
    
    // Send unshielded tokens to contract
    sendUnshielded(tokenColor, voteAmount, left(kernel.self()));
}
```

### Decision Tree: Shielded vs Unshielded

```
Does your dApp require balance privacy?
├── YES → Use Shielded Tokens
│   ├── Private payments? → Shielded
│   ├── Confidential DeFi? → Shielded
│   └── Anonymous governance? → Shielded + Nullifiers
│
└── NO → Use Unshielded Tokens
    ├── Public governance? → Unshielded
    ├── Transparent accounting? → Unshielded
    └── Regulatory compliance requiring visibility? → Unshielded
```

### Hybrid Approach: Both Models

Some contracts benefit from supporting both:

```compact
export circuit hybridTransfer(
    // Shielded path
    witness senderBalance: Uint<128>,
    witness senderSecret: Bytes<32>,
    witness merkleProof: MerkleTreePath<20, Bytes<32>>,
    public nullifier: Bytes<32>,
    public recipientCommitment: Bytes<32>,
    public amount: Uint<128>,
    
    // Unshielded path (for compliance)
    public complianceFlag: Boolean
): [] {
    if (complianceFlag) {
        // Unshielded path: transparent for regulators
        assert(unshieldedBalanceGte(tokenColor, amount), "Insufficient balance");
        sendUnshielded(tokenColor, amount, left(kernel.self()));
    } else {
        // Shielded path: private
        assert(senderBalance >= amount, "Insufficient balance");
        assert(!nullifierSet.member(nullifier), "Already spent");
        nullifierSet.insert(nullifier);
    }
}
```

---

## Part 4: Common Privacy Leaks and How to Avoid Them

### Leak #1: Correlatable Public Data

```compact
// ❌ BAD: Putting senderNullifier and recipientAddress on-chain together
// reveals that the sender transacted with the recipient
export circuit badTransfer(
    public senderNullifier: Bytes<32>,
    public recipientAddress: Bytes<32>,
    public amount: Uint<128>
): [] {
    // Observer learns: senderNullifier ↔ recipientAddress relationship
}

// ✅ GOOD: Use recipient commitments instead
export circuit goodTransfer(
    public senderNullifier: Bytes<32>,
    public recipientCommitment: Bytes<32>,  // Commitment, not address
    public amount: Uint<128>
): [] {
    // Observer can't link recipient to a real address
    // Recipient reveals address only to sender off-chain
}
```

### Leak #2: Total Supply as a Side Channel

```compact
// ❌ BAD: Total supply reveals minting activity
export ledger totalSupply: Uint<64>;

// When totalSupply increases, observers know new tokens were minted
// and can infer when new users joined

// ✅ GOOD: Use range proofs or batch minting
export circuit batchMint(
    witness commitments: Vector<Bytes<32>, 10>,
    public batchCommitment: Bytes<32>
): [] {
    // Mint 10 tokens at once — observer can't tell which are new vs existing
    // Only the batch commitment is public
}
```

### Leak #3: Merkle Tree Size Revealing Set Size

```compact
// ❌ BAD: Sequential insertion leaks set size
export ledger nextLeafIndex: Uint<32>;  // Public counter

// Observer can count leaves by watching nextLeafIndex grow

// ✅ GOOD: Use sparse trees
export ledger stateRoot: Bytes<32>;

// Leaf position derived from commitment hash, not insertion order
// Observer can't tell how many leaves are in the tree
```

### Leak #4: Disclosing Intermediate Computation Results

```compact
// ❌ BAD: Disclosing intermediate results
export circuit badCompute(
    witness privateInput: Uint<64>,
    public intermediateResult: Uint<64>
): [] {
    // If intermediateResult = privateInput + 100,
    // observers can compute privateInput = intermediateResult - 100
    assert(intermediateResult == privateInput + 100, "Invalid");
}

// ✅ GOOD: Commit to intermediate results
export circuit goodCompute(
    witness privateInput: Uint<64>,
    witness rand: Field,
    public intermediateCommitment: Field
): [] {
    // Commitment hides the value but proves it exists
    const computed = transientCommit(privateInput + 100, rand);
    assert(intermediateCommitment == disclose(computed), "Commitment mismatch");
}
```

---

## Part 5: Decision Trees for Common dApp Patterns

### Pattern 1: Private Voting System

```
Requirements:
- Each voter votes exactly once
- Vote choice is secret
- Tally is public

Decision Tree:
┌─ Eligible voters list ──► Merkle root (public)
│   Why: Proves set exists without revealing members
│
├─ Voter identity ─────────► Nullifier (public)
│   Why: Proves uniqueness without revealing identity
│
├─ Vote choice ────────────► Public (in tally map)
│   Why: Tally must be auditable
│
└─ Voter's merkle path ────► Private (witness)
    Why: Reveals position in eligibility tree
```

```compact
export circuit castVote(
    witness voterSecret: Bytes<32>,
    witness merkleProof: MerkleTreePath<20, Bytes<32>>,
    public nullifier: Bytes<32>,
    public voteOption: Uint<8>
): [] {
    // Prove eligibility without revealing identity
    const computedRoot = merkleTreePathRoot<20, Bytes<32>>(merkleProof);
    assert(eligibleVotersRoot.checkRoot(disclose(computedRoot)), "Not eligible");
    
    // Prove uniqueness
    assert(!nullifierSet.member(nullifier), "Already voted");
    
    // Record vote
    nullifierSet.insert(nullifier);
    voteTally.insert(voteOption, voteTally.lookup(voteOption) + 1);
}
```

### Pattern 2: Confidential DeFi Lending

```
Requirements:
- Borrower proves sufficient collateral
- Collateral amount is secret
- Loan terms are public
- Liquidation threshold is public

Decision Tree:
┌─ Collateral amount ──────► Private (witness)
│   Why: Reveals borrower's financial position
│
├─ Collateral commitment ──► Public (merkle root)
│   Why: Proves collateral exists
│
├─ Loan amount ────────────► Public
│   Why: Needed for protocol accounting
│
├─ Liquidation threshold ──► Public
│   Why: Anyone must verify liquidation is valid
│
└─ Borrower identity ──────► Nullifier (public)
    Why: Prevents double-borrowing without revealing identity
```

```compact
export circuit borrow(
    witness collateralAmount: Uint<128>,
    witness collateralSecret: Bytes<32>,
    witness merkleProof: MerkleTreePath<20, Bytes<32>>,
    public collateralCommitment: Bytes<32>,
    public loanAmount: Uint<128>,
    public borrowerNullifier: Bytes<32>
): [] {
    // Prove collateral exists in the tree
    const computedRoot = merkleTreePathRoot<20, Bytes<32>>(merkleProof);
    assert(collateralRoot.checkRoot(disclose(computedRoot)), "Invalid collateral");
    
    // Prove sufficient collateral (loan-to-value ratio)
    assert(collateralAmount >= loanAmount * LIQUIDATION_RATIO, "Insufficient collateral");
    
    // Prove borrower hasn't borrowed before
    assert(!borrowerNullifiers.member(borrowerNullifier), "Already borrowed");
    
    // Record loan
    borrowerNullifiers.insert(borrowerNullifier);
    totalBorrowed.insert(loanAmount);
}
```

### Pattern 3: Anonymous Allowlist

```
Requirements:
- Prove membership in allowlist
- Don't reveal which member you are
- Allowlist updates are public

Decision Tree:
├─ Allowlist members ──────► Merkle tree (root public)
│   Why: Proves membership without revealing position
│
├─ Member's merkle path ───► Private (witness)
│   Why: Reveals position in tree
│
├─ Access proof ───────────► Public (circuit output)
│   Why: Contract needs to verify access granted
│
└─ Member identity ────────► Private
    Why: Anonymous access
```

```compact
export circuit accessExclusiveArea(
    witness leaf: Bytes<32>,
    witness merkleProof: MerkleTreePath<20, Bytes<32>>
): [] {
    // Prove membership without revealing which leaf
    const computedRoot = merkleTreePathRoot<20, Bytes<32>>(merkleProof);
    assert(allowlist.checkRoot(disclose(computedRoot)), "Access denied");
    
    // Access granted — no identity revealed
}
```

---

## Part 6: Performance Implications

### Proof Size and Circuit Complexity

| State Type | Constraint Cost | Proof Size Impact |
|------------|----------------|-------------------|
| Public input | Low (type checking only) | Minimal |
| Private witness (Uint<64>) | ~64 constraints (range check) | Moderate |
| Private witness (Bytes<32>) | ~256 constraints | High |
| Merkle proof (depth 20) | ~20 hash verifications | Very high |
| Merkle proof (depth 32) | ~32 hash verifications | Extreme |

### Optimization Guidelines

1. **Minimize private state** — Every private bit costs constraints
2. **Use public inputs when possible** — They're cheaper than witnesses
3. **Limit Merkle depth** — Depth 20 (~1M leaves) is usually sufficient
4. **Batch operations** — Multiple operations in one proof are cheaper than separate proofs
5. **Cache Merkle paths** — Don't recompute paths for every transaction

---

## Summary: The Golden Rules

When you're designing a Midnight contract, here's the practical checklist:

- **Public state should exist because security needs it, not because it's convenient for debugging.** If you wouldn't put it on a billboard, it probably shouldn't be on the public ledger.
- **Export only what TypeScript clients absolutely need to read.** Every exported field is another data point an observer can correlate.
- **Disclose at the last possible moment.** If you're disclosing something and then immediately doing a ledger operation, that's fine — just don't disclose it earlier than necessary.
- **Use commitments instead of hashes when the input space is small.** A hash of a `Uint<16>` is trivially reversible. A commitment with a random salt isn't.
- **Never put a Merkle path on the public ledger.** The path tells an observer exactly which leaf you're proving membership for. Only the root should be public.
- **Intermediate computation results are the stealthiest privacy leak.** If your circuit does `result = privateValue + 100` and discloses `result`, anyone can subtract 100. Use commitments for anything derived from private data.
- **Shielded tokens for privacy, unshielded for transparency.** There's no middle ground — pick based on your protocol's actual needs, not what's easier to implement.
- **Design state to be compact and forward-only.** If your circuit requires users to provide their entire transaction history as witnesses to prove a current state, proof generation will get slower over time. Design state updates to be self-contained.

### Quick Decision Checklist

Before you finalize your contract's state design, go through each piece of data and ask yourself:

- **Does the network need to verify this to check proofs?** → If yes, it has to be public.
- **Is this needed by multiple independent users?** → Public ledger so everyone can access it.
- **Would revealing this break user privacy?** → Keep it private. No exceptions.
- **Is this needed to prevent double-spending or replay attacks?** → Public (nullifiers, nonces).
- **Does this need to persist across multiple transactions?** → Public ledger.
- **Is this only needed by the prover for local computation?** → Private witness.

If you can't answer these questions for every piece of data in your contract, you probably haven't thought through the design enough.

---

## Further Reading

- [Midnight Compact Reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Working with Maps and Merkle Trees in Compact](https://dev.to/midnight-aliit/working-with-maps-and-merkle-trees-in-compact-40i3)
- [Midnight Concepts: Ledgers](https://docs.midnight.network/concepts/ledgers)
- [Midnight Concepts: Zero-Knowledge Proofs](https://docs.midnight.network/concepts/zero-knowledge-proofs)
