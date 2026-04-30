# Anonymous Membership Proofs: Allowlists, Voter Rolls & Gated Access

There's a pattern that comes up again and again in blockchain development: you need to prove someone is in a group without revealing who they are. Maybe it's a voting system where you need to verify eligibility without exposing the voter's identity. Maybe it's an allowlist for a private event. Maybe it's a gated community where members prove membership without doxxing themselves.

Traditional approaches fail here. If you store a list of eligible addresses on-chain, everyone can see who's on the list. If you use a simple signature scheme, you can't prevent replay attacks. What you need is a way to prove membership in a set while keeping the actual member anonymous — and you need to do it in a way that prevents the same proof from being used twice.

This tutorial shows you how to build exactly that using Midnight's Compact language and sparse Merkle trees.

## The Core Problem

Let's start with what we're trying to solve. You have a set of members — voters, allowlisted users, community members — and you need to:

1. **Prove membership** — A member can prove they're in the set without revealing which element they are
2. **Prevent replay** — The same proof can't be used twice (no double-voting, no entry reuse)
3. **Keep it anonymous** — Observers can verify the proof is valid but can't tell which member submitted it
4. **Manage the set** — An admin can add/remove members without breaking existing proofs

This is what anonymous membership proofs solve. And the tool we use is a **sparse Merkle tree**.

## Sparse Merkle Trees: The Foundation

A Merkle tree is a hash tree where each leaf is a member's commitment (a hash of their secret), and each parent node is the hash of its two children. The root of the tree is a single hash that represents the entire set.

A **sparse** Merkle tree is one where leaves are positioned by their index, not by insertion order. This means:
- Leaf at index 5 is always at position 5, regardless of whether indices 0-4 exist
- You can prove membership for any index, even if most of the tree is empty
- The tree depth is fixed (we use depth-20, supporting up to ~1 million members)

Here's the key insight: **you can prove you're in the tree by providing the path from your leaf to the root** — the "siblings" at each level. The contract verifies this path and confirms the root matches. But because the path only reveals your leaf hash (not your identity) and the siblings (which are just hashes), no one can tell which member you are.

### Why Depth-20?

Depth-20 gives you 2^20 = 1,048,576 possible leaves. That's enough for most use cases. The tradeoff:
- **More depth** = more members supported, but longer proofs (more siblings to verify)
- **Less depth** = shorter proofs, but fewer members

Depth-20 is the sweet spot. Each proof requires verifying 20 sibling hashes, which is manageable for ZK proof generation.

## The Contract Design

Our contract has three pieces of public state:

```compact
contract AnonymousMembership {
    // The current root of the membership tree
    ledger membershipRoot: Bytes<32>;
    
    // Set of used nullifiers (prevents replay)
    ledger usedNullifiers: Set<Bytes<32>>;
    
    // Admin address for root management
    ledger adminAddress: Bytes<32>;
}
```

The `membershipRoot` is what the admin pushes on-chain after adding members off-chain. The `usedNullifiers` set tracks which proofs have been used — if a nullifier appears twice, the transaction is rejected. The `adminAddress` controls who can update the root.

### The Membership Verification Circuit

This is the core of the system. A member proves they're in the tree:

```compact
circuit verifyMembership(
    // Private inputs (witnesses)
    witness memberSecret: Bytes<32>,
    witness memberIndex: Uint<32>,
    witness siblings: [Bytes<32>; 20], // Depth-20 Merkle path
    witness domainSeparator: Bytes<32>,
    
    // Public inputs
    public nullifier: Bytes<32>,
    public newRoot: Bytes<32>
) {
    // Step 1: Compute leaf hash
    const leafHash: Bytes<32> = sha256(memberSecret, domainSeparator);
    
    // Step 2: Verify nullifier derivation
    const expectedNullifier: Bytes<32> = sha256(
        memberSecret, domainSeparator, Bytes<1>::from([0x01u8])
    );
    assert nullifier == expectedNullifier : "invalid nullifier derivation";
    
    // Step 3: Check nullifier hasn't been used
    assert !usedNullifiers.contains(nullifier) : "nullifier already used";
    
    // Step 4: Verify Merkle path (20 levels)
    var currentHash: Bytes<32> = leafHash;
    // ... verify each level using siblings ...
    
    // Step 5: Verify computed root matches on-chain root
    assert currentHash == membershipRoot : "invalid Merkle path";
    
    // Step 6: Record nullifier
    usedNullifiers.insert(nullifier);
    membershipRoot = newRoot;
}
```

The circuit does six things:
1. Computes the leaf hash from the member's secret and domain separator
2. Verifies the nullifier is correctly derived (prevents fake nullifiers)
3. Checks the nullifier hasn't been used (replay prevention)
4. Walks up the Merkle tree using the 20 siblings to compute the root
5. Verifies the computed root matches the on-chain root (proves membership)
6. Records the nullifier to prevent future reuse

### Domain Separation

The `domainSeparator` is a critical detail. It's a random 32-byte value that's different for each contract or use case. It serves two purposes:

1. **Prevents cross-contract correlation** — The same member can't use a proof from Contract A in Contract B
2. **Prevents cross-use correlation** — A proof used for voting can't be reused for gated access

Without domain separation, someone could link a voter's identity across multiple elections, or track which allowlisted users are trying to access different services.

## The Full Flow

Here's how it works in practice:

### Step 1: Admin Adds Members (Off-Chain)

The admin builds the Merkle tree off-chain. They collect member secrets, compute leaf hashes, and build the tree. This happens entirely off-chain — the member secrets never touch the blockchain.

```typescript
const tree = new SparseMerkleTree(20);
const domainSeparator = generateDomainSeparator();

// Add members
tree.addMember(0, member1Secret, domainSeparator);
tree.addMember(1, member2Secret, domainSeparator);
tree.addMember(2, member3Secret, domainSeparator);

const root = tree.getRoot(); // This goes on-chain
```

### Step 2: Admin Pushes Root On-Chain

The admin calls the contract to update the membership root. This is the only on-chain operation that reveals anything about the set — and it only reveals the root hash, not the individual members.

```typescript
// Admin calls updateMembershipRoot circuit
await contract.updateMembershipRoot({
  publicInputs: { newRoot: root },
  // ...
});
```

### Step 3: Member Generates Proof (Off-Chain)

When a member wants to prove membership, they generate a witness off-chain:

```typescript
const witness = createMembershipWitness(
  memberSecret,
  memberIndex,
  tree,
  domainSeparator
);

// witness contains:
// - memberSecret (private)
// - memberIndex (private)
// - siblings[20] (the Merkle path - private to the proof)
// - domainSeparator (known)
// - nullifier (public, but anonymous)
```

The witness generation requires access to the tree (to get the siblings). In production, the admin or a trusted service provides this. The member never sees other members' secrets — just their own path.

### Step 4: Member Submits Proof (On-Chain)

The member submits the proof to the contract. The contract verifies:
- The nullifier is valid
- The nullifier hasn't been used
- The Merkle path is correct
- The computed root matches the on-chain root

If all checks pass, the nullifier is recorded and the operation succeeds.

## Use Case 1: Anonymous Voting

Voting is the classic use case. You need to verify each voter is eligible, ensure they vote only once, and keep their vote anonymous.

```typescript
// Setup: Create voter roll
const voters = Array.from({ length: 1000 }, (_, i) => ({
  secret: generateSecret(),
  index: i,
}));

voters.forEach(v => tree.addMember(v.index, v.secret, domainSeparator));

// Admin pushes root
const root = tree.getRoot();
await contract.updateMembershipRoot({ newRoot: root });

// Voter 42 votes
const voter42 = voters[42];
const witness = createMembershipWitness(voter42.secret, 42, tree, domainSeparator);

// Submit vote
await contract.verifyMembership({
  publicInputs: {
    nullifier: witness.nullifier,
    newRoot: root,
  },
  witness: {
    memberSecret: voter42.secret,
    memberIndex: 42,
    siblings: witness.siblings,
    domainSeparator,
  },
});

// Voter 42 can't vote again — nullifier is recorded
```

The beauty here: the contract knows a valid voter voted, but doesn't know which voter. The nullifier prevents double-voting, but doesn't reveal identity.

## Use Case 2: Allowlists

Allowlists are simpler — you just need to prove you're on the list. No replay prevention needed (or you can use a different nullifier for each access).

```typescript
// Admin creates allowlist
const members = ['alice', 'bob', 'charlie'].map(name => {
  return {
    secret: generateSecret(),
    name,
  };
});

members.forEach((m, i) => tree.addMember(i, m.secret, domainSeparator));

// Member proves they're allowed
const bob = members[1];
const witness = createMembershipWitness(bob.secret, 1, tree, domainSeparator);

// Submit proof
await contract.verifyMembership({
  publicInputs: { nullifier: witness.nullifier, newRoot: root },
  witness: { ... },
});

// Access granted — anonymous but verified
```

## Use Case 3: Gated Access

Gated access combines allowlist with replay prevention. Each member can enter once (or N times, depending on your nullifier design).

```typescript
// Same as allowlist, but with domain-separated nullifiers
// Each event gets its own domain separator
const event1Domain = generateDomainSeparator();
const event2Domain = generateDomainSeparator();

// Member can attend both events (different nullifiers)
const witness1 = createMembershipWitness(secret, index, tree, event1Domain);
const witness2 = createMembershipWitness(secret, index, tree, event2Domain);

// witness1.nullifier !== witness2.nullifier
// Same member, different proofs, different events
```

## Common Pitfalls

**Reusing domain separators** — If you use the same domain separator across multiple contracts or events, someone can link the proofs together. Always generate a fresh domain separator for each use case.

**Leaking the member index** — The member index is part of the witness, but it's not encrypted. If the set is small (e.g., 3 members), an observer can brute-force the index by trying all possibilities. For small sets, consider adding padding members or using a larger tree.

**Not verifying the Merkle path correctly** — The circuit must verify all 20 levels of the tree. Missing even one level breaks the security guarantee. Our implementation explicitly unrolls all 20 levels for clarity.

**Admin key compromise** — The admin can update the root at any time, adding or removing members. If the admin key is compromised, the entire membership set can be manipulated. In production, use a multisig or governance contract for root management.

**Proof generation requires tree access** — Members need the Merkle siblings to generate proofs. This means either the admin provides them (centralized) or members maintain their own copy of the tree (more complex). The tradeoff is between trust and complexity.

## Performance Considerations

**Proof size** — A depth-20 Merkle proof requires 20 sibling hashes (640 bytes) plus the leaf hash and nullifier. This is manageable for ZK proof generation.

**Verification cost** — The contract verifies 20 SHA-256 hashes. This is the dominant cost in the circuit. For most use cases, this is acceptable.

**Tree updates** — Adding a member requires recomputing the root (20 hash operations). For large trees, use incremental updates rather than full recomputation.

**Nullifier storage** — Each used nullifier is stored on-chain. For high-throughput applications, consider batching nullifier checks or using a secondary layer.

## Summary

Anonymous membership proofs let you verify set membership without revealing identity. The key components are:

- **Sparse Merkle tree** — Fixed-depth tree supporting up to ~1M members
- **Depth-20 path verification** — 20 sibling hashes prove membership
- **Nullifier-based replay prevention** — Each proof can only be used once
- **Domain separation** — Prevents cross-use correlation

The pattern applies to voting, allowlists, gated access, and any scenario where you need to prove "I'm in the group" without saying "I'm Alice."

---

**Full source code:** Available in the repository linked in this PR.

**Wallet Address:** RTC6d1f27d28961279f1034d9561c2403697eb55602
