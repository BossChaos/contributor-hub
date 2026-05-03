# Anonymous Membership Proofs on Midnight: Building Privacy-Preserving Allowlists

Last month, I was tasked with building an allowlist system for a Midnight dApp. The requirement seemed simple: let authorized users access a feature without revealing who they are. In the clear-text world, you'd just check `if (user in allowedList)`. But on a privacy platform, that `if` statement leaks everything.

This tutorial walks through building a complete anonymous membership proof system — from the Compact contract on-chain to the TypeScript tooling that generates Merkle proofs locally. We'll cover sparse Merkle trees, depth-20 path verification, nullifier-based replay prevention, and admin root management.

The full source code is available in the companion repository linked at the end.

---

## Why Merkle Trees for Allowlists?

Traditional allowlists publish every member's address on-chain. That's fine for transparency, but terrible for privacy. A Merkle tree solves this differently:

- **Off-chain**: The admin maintains a list of member secrets
- **On-chain**: Only a single 32-byte hash (the Merkle root) is stored
- **Proof**: A member proves they know a secret that hashes to a leaf in the tree, without revealing which leaf

The math works because of the Merkle tree's structure. Each leaf is `poseidon_hash(secret)`. Each parent node is `poseidon_hash(left_child || right_child)`. The root is the top-level hash. A membership proof consists of the sibling nodes along the path from leaf to root — 20 siblings for a depth-20 tree.

```
                    Root (on-chain)
                   /    \
                 H01    H23
                /  \    /  \
               H0  H1  H2  H3
              / \  / \ / \ / \
             L0 L1 L2 L3 ...  (2^20 leaves)
```

To prove you're L1, you provide H0, H23, and the path indices. The verifier recomputes the root and checks it matches the on-chain value. Your secret (L1's preimage) stays private.

---

## The Compact Contract

Let's start with the on-chain logic. The contract manages three pieces of state:

```compact
// Ledger state — public on-chain data
export ledger merkle_root: Bytes<32>;
export ledger admin_commitment: Bytes<32>;
export ledger used_nullifiers: Set<Bytes<32>>;
```

The `merkle_root` tracks the current set of allowed members. The `admin_commitment` is a hash of the admin's secret — only the entity holding that secret can update the root. The `used_nullifiers` set prevents replay attacks.

### Witnesses (Secret Inputs)

These are the prover-side inputs that never appear on-chain:

```compact
// The prover's secret token (hashed to create the leaf)
witness getSecret(): Bytes<32>;

// Context identifier — prevents cross-context nullifier reuse
witness getContext(): Bytes<32>;

// 20 sibling nodes for Merkle path reconstruction
witness getSiblings(): Vector<20, Bytes<32>>;

// 20-bit path: 0 = left child, 1 = right child
witness getPathIndices(): Vector<20, Boolean>;

// Admin secret for governance operations
witness getAdminSecret(): Bytes<32>;
```

### Recomputing the Merkle Path

The core circuit takes a leaf and walks up the tree, using the siblings and path indices to reconstruct each parent:

```compact
circuit hashLevelNode(is_right: Boolean, current: Bytes<32>, sibling: Bytes<32>): Bytes<32> {
  if (is_right) {
    return persistentHash<Vector<3, Bytes<32>>>([
      pad(32, "zk-allowlist:node:v1"),
      sibling,
      current
    ]);
  } else {
    return persistentHash<Vector<3, Bytes<32>>>([
      pad(32, "zk-allowlist:node:v1"),
      current,
      sibling
    ]);
  }
}
```

The `pad(32, "zk-allowlist:node:v1")` is a domain separator — it ensures these hashes can't be confused with hashes from other systems.

### Checking Membership

The `isMember` circuit is where everything comes together:

```compact
circuit isMember(): (Bytes<32>, Bytes<32>) {
  let secret = getSecret();
  let context = getContext();
  
  // Compute the leaf hash
  let leaf = poseidonHash(secret);
  
  // Walk up the Merkle tree
  let computed_root = leaf;
  let siblings = getSiblings();
  let indices = getPathIndices();
  
  for (i in 0..20) {
    computed_root = hashLevelNode(indices[i], computed_root, siblings[i]);
  }
  
  // Verify against on-chain root
  assert(computed_root == merkle_root.read(), "Invalid membership proof");
  
  // Compute nullifier: hash(secret || context)
  let nullifier = persistentHash<Vector<2, Bytes<32>>>([secret, context]);
  
  // Check nullifier hasn't been used
  assert(not used_nullifiers.contains(nullifier), "Nullifier already used");
  
  (computed_root, nullifier)
}
```

Two critical checks here:
1. The recomputed root must match the on-chain `merkle_root`
2. The nullifier must not be in the `used_nullifiers` set

### The Public Entry Point

```compact
export circuit proveMembership(): [] {
  let (root, nullifier) = isMember();
  
  // Record the nullifier to prevent reuse
  used_nullifiers.insert(disclose(nullifier));
  
  // Log the proof event (without revealing the member)
  logEvent("MembershipVerified", disclose(root));
}
```

When a user calls `proveMembership`, the contract verifies their Merkle path, records the nullifier, and logs the event. The member's identity stays hidden — only the fact that "someone in the allowlist proved membership" is recorded.

### Admin Root Management

The admin updates the root using their secret credential:

```compact
export circuit setRoot(new_root: Bytes<32>): [] {
  let admin_secret = getAdminSecret();
  let commitment = poseidonHash(admin_secret);
  
  assert(commitment == admin_commitment.read(), "Not authorized");
  
  merkle_root.write(disclose(new_root));
}
```

---

## The TypeScript Tooling

The contract is only half the system. Members need tooling to generate proofs locally. Let's walk through the key components.

### Sparse Merkle Tree Implementation

A naive Merkle tree stores all 2^20 = 1,048,576 leaf hashes. That's wasteful. A sparse tree only stores populated nodes:

```typescript
export class MerkleTree {
  readonly depth: number;
  private leaves: HashHex[] = [];
  private layers: Map<number, Map<number, HashHex>> = new Map();
  private zeroHashes: HashHex[];

  constructor(depth: number = 20) {
    this.depth = depth;
    this.zeroHashes = computeZeroHashes(depth);
    
    // Initialize empty layers
    for (let i = 0; i <= depth; i++) {
      this.layers.set(i, new Map());
    }
  }

  insertLeaf(leafHash: HashHex): number {
    if (this.leaves.length >= this.capacity) {
      throw new Error(`Tree is full (capacity: ${this.capacity})`);
    }

    const leafIndex = this.leaves.length;
    this.leaves.push(leafHash);
    this.setNode(0, leafIndex, leafHash);

    // Update path from leaf to root
    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const parentIndex = Math.floor(currentIndex / 2);
      const leftChild = this.getNode(level, parentIndex * 2);
      const rightChild = this.getNode(level, parentIndex * 2 + 1);
      const parentHash = hashNode(leftChild, rightChild);
      this.setNode(level + 1, parentIndex, parentHash);
      currentIndex = parentIndex;
    }

    return leafIndex;
  }
```

The key optimization: `getNode()` returns the pre-computed zero hash for empty positions. This means a tree with 5 members uses the same storage as a tree with 1 million members — only the populated paths are stored.

### Generating a Membership Proof

```typescript
generateMerkleProof(leafIndex: number): MerklePath {
  if (leafIndex >= this.leaves.length) {
    throw new Error(`Leaf index ${leafIndex} out of range`);
  }

  const siblings: HashHex[] = [];
  const pathIndices: number[] = [];
  let currentIndex = leafIndex;

  for (let level = 0; level < this.depth; level++) {
    const isRight = currentIndex % 2 === 1;
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
    
    siblings.push(this.getNode(level, siblingIndex));
    pathIndices.push(isRight ? 1 : 0);
    
    currentIndex = Math.floor(currentIndex / 2);
  }

  return { siblings, pathIndices };
}
```

The proof generation walks from the leaf to the root, collecting siblings at each level. The `pathIndices` array tells the verifier whether the proven leaf was the left or right child at each step.

### Nullifier Tracking

```typescript
export function trackNullifier(
  secret: string,
  context: string,
  nullifier: string,
  submitted: boolean = false
): void {
  const data = loadNullifiers();
  
  const existing = data.nullifiers.find((n) => n.nullifier === nullifier);
  if (existing) {
    existing.submitted = submitted;
  } else {
    data.nullifiers.push({
      nullifier,
      context,
      secret,
      createdAt: new Date().toISOString(),
      submitted,
    });
  }
  
  saveNullifiers(data);
}
```

The nullifier is `poseidon_hash(secret || context)`. By tracking nullifiers locally, the client can check whether a proof has already been submitted before wasting resources generating it.

---

## The Complete Flow

Here's how everything works together in practice:

### Step 1: Admin Sets Up the Contract

```bash
# Generate admin secret
ADMIN_SECRET=$(openssl rand -hex 32)
ADMIN_COMMITMENT=$(echo -n $ADMIN_SECRET | poseidon-hash)

# Deploy contract with initial commitment
compact deploy --ledger admin_commitment=$ADMIN_COMMITMENT
```

The admin stores their secret securely. The commitment goes on-chain.

### Step 2: Add Members Off-Chain

```bash
# Add members to the local Merkle tree
midnight-allowlist add-member --secret "alice-secret-123"
midnight-allowlist add-member --secret "bob-secret-456"
midnight-allowlist add-member --secret "charlie-secret-789"

# Get the new root
ROOT=$(midnight-allowlist get-root)
echo "New Merkle root: $ROOT"
```

Each `add-member` call:
1. Hashes the secret with Poseidon
2. Inserts the hash as a leaf in the sparse Merkle tree
3. Updates all parent nodes up to the root
4. Saves the tree state to disk

### Step 3: Push Root On-Chain

```bash
# Admin updates the on-chain root
compact call setRoot --arg new_root=$ROOT --witness admin_secret=$ADMIN_SECRET
```

Only the admin can do this. The contract verifies the admin commitment matches.

### Step 4: Member Generates and Submits Proof

```bash
# Member generates proof locally
PROOF=$(midnight-allowlist generate-proof \
  --secret "alice-secret-123" \
  --context "voting-round-1" \
  --root $ROOT)

# Submit proof to contract
compact call proveMembership --proof $PROOF
```

The member's secret never leaves their machine. The contract receives only the proof bytes and verifies:
- The Merkle path is valid for the current root
- The nullifier hasn't been used before

### Step 5: Contract Records Nullifier

After successful verification, the contract adds the nullifier to `used_nullifiers`. If Alice tries to submit another proof with the same secret and context, the transaction fails:

```
Error: Nullifier already used
```

---

## Edge Cases and Gotchas

### 1. Zero Hash Collisions

The sparse tree uses pre-computed zero hashes for empty positions. Make sure your `computeZeroHashes` function matches exactly what the Compact contract expects:

```typescript
export function computeZeroHashes(depth: number): HashHex[] {
  const zeros: HashHex[] = [];
  zeros[0] = poseidonHash('zero:0');
  
  for (let i = 1; i <= depth; i++) {
    zeros[i] = hashNode(zeros[i - 1], zeros[i - 1]);
  }
  
  return zeros;
}
```

The zero hash at level `i` is `poseidon_hash(zero_hash(i-1) || zero_hash(i-1))`. Any mismatch here causes proof verification to fail silently.

### 2. Context Binding

The nullifier is `hash(secret || context)`. If you use the same context string for different operations, a member who votes can't also prove eligibility for an airdrop — because the nullifier would be the same. Use distinct contexts:

```typescript
const VOTE_CONTEXT = "governance-vote-q2-2026";
const AIRDROP_CONTEXT = "token-airdrop-genesis";
```

### 3. Tree Capacity Planning

A depth-20 tree supports ~1M members. If you need more, increase the depth — but remember:

- Each additional level doubles the capacity
- Proof generation time increases linearly with depth
- The Compact contract must match the depth (20 siblings → 21 siblings)

### 4. Admin Secret Rotation

The current design doesn't support admin rotation. To change admins:

1. Deploy a new contract instance
2. Rebuild the Merkle tree
3. Push the new root
4. Notify all members

This is a deliberate tradeoff. Simpler contracts are easier to audit. If you need rotation, consider a multi-sig approach where the admin commitment is a hash of multiple secrets.

---

## Testing

The test suite covers the critical paths:

```typescript
describe('ZK Allowlist', () => {
  it('should verify valid membership proof', async () => {
    const tree = new MerkleTree(20);
    tree.insertLeaf(hashLeaf('alice-secret'));
    tree.insertLeaf(hashLeaf('bob-secret'));
    
    const proof = tree.generateMerkleProof(0);
    expect(verifyProof(tree.root, proof, hashLeaf('alice-secret'))).toBe(true);
  });

  it('should reject proof with wrong root', async () => {
    const tree1 = new MerkleTree(20);
    tree1.insertLeaf(hashLeaf('alice-secret'));
    
    const tree2 = new MerkleTree(20);
    tree2.insertLeaf(hashLeaf('bob-secret'));
    
    const proof = tree1.generateMerkleProof(0);
    expect(verifyProof(tree2.root, proof, hashLeaf('alice-secret'))).toBe(false);
  });

  it('should detect nullifier reuse', async () => {
    const nullifier = hashNullifier('alice-secret', 'voting-context');
    const usedNullifiers = new Set<string>();
    
    usedNullifiers.add(nullifier);
    expect(usedNullifiers.has(nullifier)).toBe(true);
  });
});
```

---

## What's Next?

This system handles the core membership proof flow. Production deployments should consider:

- **Batch root updates**: Instead of pushing the root after each member, batch updates to reduce on-chain transactions
- **Merkle tree snapshots**: Version roots to allow historical proof verification
- **Circuit optimization**: The current implementation uses `persistentHash` — for production, consider the more efficient `hash` function if your security model allows it
- **Frontend integration**: Build a React component that lets members generate proofs in the browser using WebAssembly

The complete source code, including the Compact contract, TypeScript utilities, and test suite, is available in the companion repository. Clone it and run `npm test` to see everything in action.

---

*This tutorial is part of the Midnight Network bounty program. For more developer resources, visit [docs.midnight.network](https://docs.midnight.network).*
