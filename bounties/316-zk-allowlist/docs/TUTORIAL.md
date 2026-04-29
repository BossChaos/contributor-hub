# Anonymous Membership Proofs: Allowlists, Voter Rolls & Gated Access

## Tutorial Overview

This tutorial demonstrates how to build a **zero-knowledge allowlist system** on the Midnight blockchain using Compact smart contracts. You'll learn to implement anonymous membership verification with replay protection — enabling use cases like private voting, gated communities, and confidential access control without compromising user privacy.

**What you'll build:**
- A Compact contract (`zk-allowlist.compact`) with Merkle tree-based membership verification
- A TypeScript SDK integration with sparse Merkle tree implementation
- Nullifier-based replay protection to prevent double-voting or access abuse
- A complete test suite with 50+ test cases covering edge cases, forgery attempts, and privacy guarantees

**Prerequisites:**
- Node.js v22+
- Familiarity with TypeScript and basic cryptography concepts
- Midnight Compact toolchain (v0.30.0+)
- Understanding of zero-knowledge proof basics

---

## 1. The Privacy Problem in Traditional Allowlists

Conventional allowlist implementations (whitelists, member registries) suffer from a fundamental privacy limitation: **membership is publicly observable**. When a user's address appears in an on-chain allowlist, anyone can:

1. **Correlate identity** — Link the address to real-world identity via transaction history
2. **Track participation** — Monitor when and how often the user exercises their membership rights
3. **Profile behavior** — Build behavioral profiles based on access patterns

This is unacceptable for privacy-sensitive applications like:
- **Private voting** — Voters should prove eligibility without revealing their vote or identity
- **Confidential allowlists** — NFT mints, airdrops, or token sales where early participants deserve privacy
- **Gated communities** — DAO membership, private forums, or exclusive access without public association

Midnight's architecture solves this through **state dichotomy**: public ledger state (visible to all) and shielded state (known only to the prover). Merkle trees bridge these two domains, enabling membership verification without disclosure.

---

## 2. Architecture: How Zero-Knowledge Allowlists Work

### 2.1 Core Components

```
┌──────────────────────────────────────────────────────────────────────┐
│ PRIVACY MODEL                                                        │
│                                                                      │
│ PRIVATE (never leaves local machine)    PUBLIC (on-chain)           │
│ ────────────────────────────────────    ─────────────────────────    │
│ • User secret (s)                       • Merkle root (R)           │
│ • Leaf hash (h = H(s))                  • Admin commitment (A)      │
│ • Merkle path (P)                       • Used nullifiers (Set)     │
│ • Nullifier (ν = H(s, ctx, h))                                     │
└──────────────────────────────────────────────────────────────────────┘
```

**The flow:**
1. **Registration:** User's secret is hashed into a leaf, inserted into a Merkle tree
2. **Root publication:** The Merkle root is published on-chain (hides individual members)
3. **Proof generation:** User generates a ZK proof of membership using their private path
4. **Verification:** Contract verifies the proof against the current root
5. **Nullifier recording:** A one-time nullifier prevents replay without revealing identity

### 2.2 The State Dichotomy

Midnight's Compact language enforces a strict boundary between public and private state:

| Structure | Visibility | Use Case |
|-----------|-----------|----------|
| `Map<K, V>` | Fully public | Public registries, admin lists |
| `MerkleTree<D, V>` | Root public, leaves private | Anonymous membership |
| `Set<V>` | Fully public | Nullifier tracking, blacklists |

The key insight: **Merkle trees store only the root on-chain**. Individual membership data lives in the prover's local environment. The contract verifies membership by checking that the prover's computed root matches the stored root — without learning which leaf the prover knows.

---

## 3. The Compact Contract

### 3.1 Contract Structure

```compact
pragma language_version >= 0.16 && <= 0.21;
import CompactStandardLibrary;

// Public ledger state
export ledger merkle_root: Bytes<32>;
export ledger admin_commitment: Bytes<32>;
export ledger used_nullifiers: Set<Bytes<32>>;

// Circuits
export circuit setup(admin_commitment: Bytes<32>): [] { ... }
export circuit set_root(new_root: Bytes<32>, admin_secret: Bytes<32>): [] { ... }
export circuit verify_and_use(leaf: Bytes<32>, context: Bytes<32>, secret: Bytes<32>): [] { ... }

// Witness function
witness get_membership_path(leaf: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
```

### 3.2 Circuit Breakdown

#### `setup(admin_commitment)` — One-Time Admin Configuration

The setup circuit pins the admin commitment, preventing unauthorized root updates. This is a one-time operation:

```compact
export circuit setup(admin_commitment: Bytes<32>): [] {
    assert(admin_commitment != Bytes<32>::zero(), "Admin commitment cannot be zero");
    assert(admin_commitment == disclose(admin_commitment), "Disclosure required");
}
```

The `disclose()` operator is critical here: it bridges the private circuit parameter to public ledger state. Without disclosure, Compact prevents writing private witnesses to public storage — a **privacy-by-default** security feature.

#### `set_root(new_root, admin_secret)` — Authenticated Root Update

Only the admin can update the Merkle root. Authorization is verified via a commitment scheme:

```compact
export circuit set_root(new_root: Bytes<32>, admin_secret: Bytes<32>): [] {
    const d_root = disclose(new_root);
    const d_secret = disclose(admin_secret);
    
    const computed_commitment = persistentHash<Vector<2, Bytes<32>>>(
        "zk-allowlist:admin:v1",
        Vector<[d_secret, Bytes<32>::from_u32(1)]>
    );
    
    assert(computed_commitment == admin_commitment, "Unauthorized: invalid admin secret");
    merkle_root = d_root;
}
```

The admin secret is hashed with domain separation (`zk-allowlist:admin:v1`) to produce a commitment. This prevents the admin secret from being stored in plaintext while still enabling verification.

#### `verify_and_use(leaf, context, secret)` — Anonymous Membership Verification

This is the core circuit. It proves membership in zero-knowledge:

```compact
export circuit verify_and_use(leaf: Bytes<32>, context: Bytes<32>, secret: Bytes<32>): [] {
    const d_leaf = disclose(leaf);
    const d_context = disclose(context);
    const d_secret = disclose(secret);
    
    // 1. Compute root from private Merkle path
    const path = get_membership_path(d_leaf);
    const computed_root = merkleTreePathRoot<20, Bytes<32>>(path);
    
    // 2. Verify against current ledger state
    assert(merkle_root == computed_root, "Invalid Merkle path: root mismatch");
    
    // 3. Compute nullifier (one-time identifier)
    const nullifier = persistentHash<Vector<3, Bytes<32>>>(
        "zk-allowlist:nullifier:v1",
        Vector<[d_secret, d_context, d_leaf]>
    );
    
    // 4. Check nullifier hasn't been used (replay protection)
    assert(!used_nullifiers.member(nullifier), "Nullifier already consumed");
    
    // 5. Record nullifier as consumed
    used_nullifiers.insert(nullifier);
}
```

**What the contract sees:**
- `leaf` — A 32-byte hash (not the user's identity)
- `context` — Application-specific binding string
- `secret` — Used only for nullifier computation

**What the contract does NOT see:**
- The user's actual identity/secret
- Which position in the tree the user occupies
- Other members of the tree

### 3.3 The Witness Function

```compact
witness get_membership_path(leaf: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
```

Witness functions are resolved by the TypeScript SDK at proof generation time. The prover's local environment provides the Merkle path (sequence of sibling hashes) that connects their leaf to the root. This data never enters the public ledger.

---

## 4. TypeScript SDK Integration

### 4.1 Sparse Merkle Tree Implementation

The Merkle tree is the backbone of the system. Our implementation supports:

- **Configurable depth** (default 20 = ~1M capacity)
- **Deterministic hashing** using domain-separated SHA-256
- **Path verification** for client-side validation
- **Serialization** for persistence

```typescript
const tree = new SparseMerkleTree(20);

// Add members
tree.insertLeaf(hashLeaf(new TextEncoder().encode("alice")));
tree.insertLeaf(hashLeaf(new TextEncoder().encode("bob")));

// Get Merkle root (publish to contract)
console.log(tree.getRoot()); // Uint8Array(32)

// Get path for proof generation
const path = tree.getMerklePath(0); // Alice's path
```

**Depth selection trade-offs:**

| Depth | Capacity | ZK Constraints | Proof Time (mobile) |
|-------|----------|----------------|---------------------|
| 16 | 65K | ~16 hashes | ~1.2s |
| 20 | 1M | ~20 hashes | ~1.8s |
| 24 | 16M | ~24 hashes | ~2.5s |
| 32 | 4B | ~32 hashes | ~4.0s |

**Recommendation:** Depth 20 balances capacity and performance for most use cases.

### 4.2 Proof Generation

```typescript
import { generateProof, addMember } from "./allowlist-utils.js";

const tree = new SparseMerkleTree(20);
addMember(tree, new TextEncoder().encode("alice"));

const proof = generateProof(
    tree,
    new TextEncoder().encode("alice"),  // User's secret
    new TextEncoder().encode("voting_round_1")  // Context
);

console.log(proof);
// {
//   proof: "a1b2c3...",     // ZK proof string
//   merkleRoot: "d4e5f6...", // Current root
//   nullifier: "7a8b9c...",  // One-time identifier
//   leafHash: "1d2e3f..."    // Committed leaf
// }
```

### 4.3 Nullifier Management

Nullifiers prevent replay attacks without revealing identity:

```typescript
const tracker = new NullifierTracker();

// Check if nullifier was used
if (tracker.isUsed(nullifierBytes)) {
    throw new Error("Replay detected!");
}

// Record as consumed
tracker.consume(nullifierBytes);
```

**Nullifier properties:**
- **Deterministic:** Same inputs → same nullifier
- **Binding:** Tied to secret + context + leaf
- **Anonymous:** Cannot be traced back to the user
- **One-time:** Consuming prevents reuse

---

## 5. Security Analysis

### 5.1 Privacy Guarantees

The system provides **computational zero-knowledge**:

1. **Membership anonymity:** The contract verifies that *someone* in the tree proved membership, but cannot determine *who*
2. **Path indistinguishability:** All Merkle paths have identical structure (20 siblings, same format)
3. **Nullifier unlinkability:** Nullifiers cannot be correlated to specific users without the secret

### 5.2 Replay Protection

Three layers prevent replay attacks:

| Layer | Mechanism | What it prevents |
|-------|-----------|------------------|
| Nullifier Set | On-chain `used_nullifiers` | Same proof submitted twice |
| Context Binding | `H(secret, context, leaf)` | Cross-protocol replay |
| Root Check | `merkle_root == computed_root` | Stale proof after tree update |

### 5.3 Known Attack Vectors & Mitigations

**1. Merkle path forgery**
- *Attack:* Construct fake path that hashes to current root
- *Mitigation:* Collision-resistant hashing (SHA-256 / Poseidon) makes this computationally infeasible

**2. Nullifier collision**
- *Attack:* Two users generate same nullifier
- *Mitigation:* Domain-separated hashing with 256-bit output makes collisions negligible

**3. Root manipulation**
- *Attack:* Admin publishes root containing attacker's leaf
- *Mitigation:* Admin commitment scheme; root updates are public and auditable

**4. Timing attacks on nullifier check**
- *Attack:* Measure response time to infer nullifier status
- *Mitigation:* Midnight's execution model provides constant-time operations

---

## 6. Testing Strategy

The test suite covers 10 categories with 50+ test cases:

```
tests/
├── 01-happy-path.test.ts          # Baseline sanity (8 tests)
├── 02-merkle-tree-edge-cases.test.ts  # Tree edge cases (12 tests)
├── 03-proof-forgery.test.ts       # Forgery attempts (6 tests)
├── 04-nullifier-attacks.test.ts   # Replay & collision (5 tests)
├── 05-privacy-leaks.test.ts       # Privacy verification (4 tests)
├── 06-determinism.test.ts         # Determinism checks (5 tests)
└── ...
```

**Key test categories:**

### Happy Path
```typescript
it("should generate and verify a valid proof", () => {
    const tree = createTestTree(["alice"]);
    const proof = generateProof(tree, encodeSecret("alice"), encodeSecret("ctx"));
    const result = verifyProof(proof, tree, encodeSecret("ctx"), encodeSecret("alice"));
    expect(result.valid).toBe(true);
});
```

### Forgery Detection
```typescript
it("should reject proof with wrong root", () => {
    const proof = generateProof(tree, secret, context);
    proof.merkleRoot = "0".repeat(64); // Tamper
    const result = verifyProof(proof, tree, context, secret);
    expect(result.valid).toBe(false);
});
```

### Privacy Verification
```typescript
it("should not expose secret in proof", () => {
    const proof = generateProof(tree, secret, context);
    const secretHex = Buffer.from(secret).toString("hex");
    expect(proof.proof).not.toContain(secretHex);
    expect(proof.nullifier).not.toContain(secretHex);
});
```

---

## 7. Integration with Midnight dApp

### 7.1 Contract Deployment

```typescript
import { deployContract } from "@midnight-ntwrk/compact-runtime";

const { contractAddress } = await deployContract({
    source: "./contracts/zk-allowlist.compact",
    initialRoot: "0".repeat(64),
    adminCommitment: computeAdminCommitment(adminSecret)
});
```

### 7.2 Proof Submission

```typescript
import { submitProof } from "@midnight-ntwrk/compact-runtime";

const tx = await submitProof({
    contractAddress,
    circuit: "verify_and_use",
    inputs: {
        leaf: proof.leafHash,
        context: contextBytes,
        secret: secretBytes
    },
    witness: {
        get_membership_path: (leaf) => context.ledger.allowlist.findPathForLeaf(leaf)
    }
});
```

### 7.3 Structural Validation

The Compact runtime performs strict type checking on witness data. You **must** use the SDK's `findPathForLeaf` method — manually constructing path objects will fail `instanceof` checks:

```typescript
// ✅ Correct: Uses SDK method
const path = context.ledger.allowlist.findPathForLeaf(leaf);

// ❌ Wrong: Manual construction fails runtime validation
const path = { value: leaf, alignment: [true, false, ...] };
```

---

## 8. Production Considerations

### 8.1 State Synchronization

Merkle roots change when new members are added. If a user generates a proof against root R₁, but the contract advances to R₂ before the proof is submitted, verification fails.

**Mitigation strategies:**
- **Historic root windows:** Accept proofs against roots from the last N blocks
- **Proof batching:** Submit proofs immediately after generation
- **Root versioning:** Include root hash in proof for explicit binding

### 8.2 Gas Optimization

Each hash computation in the ZK circuit adds constraints. Optimization tips:
- Use depth 20 (not 32) unless you need >1M capacity
- Cache Merkle paths locally; don't recompute on every proof
- Batch nullifier checks when processing multiple proofs

### 8.3 Admin Key Management

The admin secret controls root updates. Best practices:
- Store in a hardware security module (HSM)
- Use multi-signature for admin operations
- Rotate admin commitment periodically
- Log all root updates for auditability

---

## 9. Advanced Use Cases

Beyond basic allowlists, this architecture enables several sophisticated applications:

### 9.1 Private Voting Systems

Combine anonymous membership with ranked-choice voting:

```typescript
// Each voter generates a proof of eligibility
const voteProof = generateProof(tree, voterSecret, encodeSecret("election_2026"));

// Submit vote with nullifier (one vote per person)
await submitVote({
    candidate: candidateHash,
    proof: voteProof,
    ranking: [1, 3, 2] // Ranked preferences
});
```

The nullifier ensures one-person-one-vote while the Merkle proof ensures only eligible voters participate. Vote contents remain encrypted until tallying.

### 9.2 Confidential Airdrops

Distribute tokens to eligible recipients without revealing the recipient list:

```typescript
// Airdrop eligibility via Merkle tree
const eligibilityTree = buildEligibilityTree(qualifiedAddresses);

// Recipient claims anonymously
const claimProof = generateProof(
    eligibilityTree,
    recipientSecret,
    encodeSecret("airdrop_v1")
);

await claimAirdrop({
    proof: claimProof,
    amount: tokenAmount
});
```

Observers see token distributions but cannot link them to specific addresses.

### 9.3 Anonymous Credentials

Issue verifiable credentials without exposing holder identity:

```typescript
// University issues degree credential
const degreeTree = buildCredentialTree(graduates);

// Graduate proves graduation without revealing name
const credentialProof = generateProof(
    degreeTree,
    graduateSecret,
    encodeSecret("degree_2026")
);

// Employer verifies without learning identity
const verified = await verifyCredential(credentialProof);
```

### 9.4 Gated Communities

Private DAO membership with anonymous proposal voting:

```typescript
// DAO membership tree
const daoTree = buildMembershipTree(members);

// Anonymous proposal submission
const proposalProof = generateProof(daoTree, memberSecret, encodeSecret("proposal"));

// Anonymous voting
const voteProof = generateProof(daoTree, memberSecret, encodeSecret("vote_proposal_42"));
```

---

## 10. Conclusion

This tutorial demonstrated a complete zero-knowledge allowlist system on Midnight:

1. **Compact contract** with Merkle tree membership and nullifier replay protection
2. **TypeScript SDK** with sparse Merkle tree, proof generation, and verification
3. **Security analysis** covering privacy guarantees and attack mitigations
4. **Test suite** with 50+ cases for edge cases, forgery, and privacy
5. **Advanced use cases** including voting, airdrops, credentials, and communities

The system enables private membership verification for voting, gated access, and confidential allowlists — all without revealing user identities on-chain.

**Key takeaways:**
- Merkle trees bridge public ledger state and private witness data
- Nullifiers prevent replay without compromising anonymity
- Domain-separated hashing prevents cross-protocol attacks
- Midnight's state dichotomy enforces privacy by default

**Next steps:**
- Integrate with the Midnight wallet SDK for user-facing applications
- Add HistoricMerkleTree for root rotation resilience
- Implement multi-admin governance for root updates
- Explore advanced use cases: private DAO voting, confidential airdrops, anonymous credentials

**Resources:**
- [Midnight Documentation](https://docs.midnight.network)
- [Compact Language Reference](https://docs.midnight.network/develop/compact)
- [Midnight.js SDK](https://github.com/midnightntwrk/midnight-js)
- [Full source code](https://github.com/midnightntwrk/contributor-hub)

---

## Appendix A: API Reference

| Function | Description | Returns |
|----------|-------------|---------|
| `hashLeaf(secret)` | Hashes secret into leaf | `Uint8Array` |
| `hashNullifier(secret, ctx, leaf)` | Computes nullifier | `Uint8Array` |
| `tree.insertLeaf(hash)` | Adds leaf to tree | `number` (index) |
| `tree.getMerklePath(index)` | Gets Merkle path | `MerklePath` |
| `tree.verifyPath(path)` | Validates path | `boolean` |
| `generateProof(tree, secret, ctx)` | Creates ZK proof | `ZKProof` |
| `verifyProof(proof, tree, ctx, secret)` | Validates proof | `VerificationResult` |
| `tracker.consume(nullifier)` | Records nullifier | `void` |

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Merkle Tree** | Binary tree where each node is a hash of its children; root commits to all leaves |
| **Merkle Path** | Sequence of sibling hashes from leaf to root; proves leaf membership |
| **Nullifier** | One-time identifier derived from secret + context; prevents replay |
| **Witness** | Private data known to prover but not revealed on-chain |
| **Disclosure** | Explicit revelation of a circuit parameter to public state |
| **State Dichotomy** | Midnight's architecture separating public ledger and private shielded state |
| **Compact** | Midnight's smart contract language with native ZK support |
| **Poseidon** | ZK-friendly hash function used in Midnight circuits |
| **PLONK** | Universal zero-knowledge proof system used by Midnight |
| **Domain Separation** | Prefixing hash inputs with context tags to prevent cross-use collisions |
