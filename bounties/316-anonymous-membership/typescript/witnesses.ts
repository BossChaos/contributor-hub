// TypeScript Witnesses for Anonymous Membership Proofs
// Implements Merkle tree operations and witness generation for depth-20 paths

import { randomBytes, createHash } from 'crypto';

// Merkle tree depth - 20 levels supports ~1 million members (2^20)
const MERKLE_DEPTH = 20;

/**
 * Compute leaf hash from member secret and domain separator
 * H(memberSecret, domainSeparator)
 * Domain separator prevents cross-contract correlation
 */
export function computeLeafHash(
  memberSecret: Uint8Array,
  domainSeparator: Uint8Array
): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(memberSecret));
  hash.update(Buffer.from(domainSeparator));
  return hash.digest();
}

/**
 * Compute nullifier from member secret
 * H(memberSecret, domainSeparator, 0x01)
 * The 0x01 suffix distinguishes nullifiers from leaf hashes
 * Each nullifier can only be used once (replay prevention)
 */
export function computeNullifier(
  memberSecret: Uint8Array,
  domainSeparator: Uint8Array
): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(memberSecret));
  hash.update(Buffer.from(domainSeparator));
  hash.update(Buffer.from([0x01])); // Domain suffix for nullifiers
  return hash.digest();
}

/**
 * Compute Merkle node hash from two children
 * H(left || right)
 */
export function computeMerkleNode(
  left: Uint8Array,
  right: Uint8Array
): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(left));
  hash.update(Buffer.from(right));
  return hash.digest();
}

/**
 * Sparse Merkle Tree implementation
 * Supports depth-20 trees (up to ~1M members)
 */
export class SparseMerkleTree {
  private depth: number;
  private leaves: Map<number, Uint8Array>;
  private root: Uint8Array;
  private defaultHashes: Uint8Array[]; // Pre-computed empty hashes for each level

  constructor(depth: number = MERKLE_DEPTH) {
    this.depth = depth;
    this.leaves = new Map();
    this.defaultHashes = this.computeDefaultHashes();
    this.root = this.defaultHashes[depth]; // Start with empty tree root
  }

  /**
   * Pre-compute default hashes for empty positions
   * H(0, 0) at each level
   */
  private computeDefaultHashes(): Uint8Array[] {
    const hashes: Uint8Array[] = [];
    // Level 0: hash of two empty 32-byte values
    let current = createHash('sha256')
      .update(Buffer.alloc(32, 0))
      .update(Buffer.alloc(32, 0))
      .digest();
    hashes.push(current);

    // Build up for each level
    for (let i = 1; i <= this.depth; i++) {
      current = computeMerkleNode(hashes[i - 1], hashes[i - 1]);
      hashes.push(current);
    }

    return hashes;
  }

  /**
   * Add a member to the tree
   * Returns the new root
   */
  addMember(index: number, memberSecret: Uint8Array, domainSeparator: Uint8Array): Uint8Array {
    // Compute leaf hash
    const leafHash = computeLeafHash(memberSecret, domainSeparator);
    this.leaves.set(index, leafHash);

    // Recompute root
    this.root = this.computeRoot();
    return this.root;
  }

  /**
   * Get Merkle proof (siblings) for a given index
   * Returns the 20 sibling hashes needed to verify membership
   */
  getProof(index: number): Uint8Array[] {
    const siblings: Uint8Array[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.depth; level++) {
      // Determine sibling index (left or right)
      const isRight = (currentIndex >> level) & 1;
      const siblingIndex = isRight ? currentIndex - (1 << level) : currentIndex + (1 << level);

      // Get sibling hash (or default if not in tree)
      const siblingHash = this.leaves.get(siblingIndex) || this.defaultHashes[level];
      siblings.push(siblingHash);
    }

    return siblings;
  }

  /**
   * Verify a Merkle proof
   * Returns true if the proof is valid for the given leaf and root
   */
  static verifyProof(
    leafHash: Uint8Array,
    index: number,
    siblings: Uint8Array[],
    root: Uint8Array,
    depth: number = MERKLE_DEPTH
  ): boolean {
    let currentHash = leafHash;

    for (let level = 0; level < depth; level++) {
      const isRight = (index >> level) & 1;
      const sibling = siblings[level];

      if (isRight) {
        currentHash = computeMerkleNode(sibling, currentHash);
      } else {
        currentHash = computeMerkleNode(currentHash, sibling);
      }
    }

    // Compare computed root with expected root
    return Buffer.from(currentHash).equals(Buffer.from(root));
  }

  /**
   * Compute the current root of the tree
   */
  private computeRoot(): Uint8Array {
    // Build tree bottom-up
    let currentLevel: Map<number, Uint8Array> = new Map(this.leaves);

    for (let level = 0; level < this.depth; level++) {
      const nextLevel: Map<number, Uint8Array> = new Map();

      // Get all indices at this level
      const indices = new Set([...currentLevel.keys()]);
      // Add sibling indices
      for (const idx of indices) {
        const siblingIdx = (idx % 2 === 0) ? idx + 1 : idx - 1;
        indices.add(siblingIdx);
      }

      // Compute parent nodes
      for (const idx of indices) {
        if (idx % 2 === 0) {
          const left = currentLevel.get(idx) || this.defaultHashes[level];
          const right = currentLevel.get(idx + 1) || this.defaultHashes[level];
          nextLevel.set(idx >> 1, computeMerkleNode(left, right));
        }
      }

      currentLevel = nextLevel;
    }

    // Root is at index 0
    return currentLevel.get(0) || this.defaultHashes[this.depth];
  }

  /**
   * Get the current root
   */
  getRoot(): Uint8Array {
    return this.root;
  }

  /**
   * Get the number of members
   */
  getMemberCount(): number {
    return this.leaves.size;
  }
}

/**
 * Witness generation for verifyMembership circuit
 */
export interface MembershipWitness {
  memberSecret: Uint8Array;
  memberIndex: number;
  siblings: Uint8Array[]; // 20 sibling hashes
  domainSeparator: Uint8Array;
  nullifier: Uint8Array;
}

export function createMembershipWitness(
  memberSecret: Uint8Array,
  memberIndex: number,
  tree: SparseMerkleTree,
  domainSeparator: Uint8Array
): MembershipWitness {
  const siblings = tree.getProof(memberIndex);
  const nullifier = computeNullifier(memberSecret, domainSeparator);

  return {
    memberSecret,
    memberIndex,
    siblings,
    domainSeparator,
    nullifier,
  };
}

/**
 * Witness generation for updateMembershipRoot circuit
 */
export interface AdminUpdateWitness {
  adminSecret: Uint8Array;
  adminNullifier: Uint8Array;
}

export function createAdminUpdateWitness(
  adminSecret: Uint8Array
): AdminUpdateWitness {
  const hash = createHash('sha256');
  hash.update(Buffer.from(adminSecret));
  hash.update(Buffer.from([0xAD])); // Admin domain suffix
  const adminNullifier = hash.digest();

  return {
    adminSecret,
    adminNullifier,
  };
}

/**
 * Utility: Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Utility: Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  return Buffer.from(hex, 'hex');
}

/**
 * Generate a random 32-byte secret
 */
export function generateSecret(): Uint8Array {
  return randomBytes(32);
}

/**
 * Generate a random domain separator
 * Different domains prevent cross-use correlation
 */
export function generateDomainSeparator(): Uint8Array {
  return randomBytes(32);
}
