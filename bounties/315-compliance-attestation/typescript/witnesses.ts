// TypeScript Witnesses for Compliance Attestation System
// Implements selective disclosure proofs with domain-separated hashing
// Cross-property unlinkability ensures different property proofs can't be correlated

import { randomBytes, createHash } from 'crypto';

// Merkle tree depth - 20 levels supports ~1M attestations
const MERKLE_DEPTH = 20;

/**
 * Property types supported by the attestation system
 * Each property can be selectively disclosed
 */
export enum PropertyType {
  AGE = 'age',
  RESIDENCY = 'residency',
  CERTIFICATION = 'certification',
  ACCREDITATION = 'accreditation',
}

/**
 * Property data structure
 * Contains the actual property value and metadata
 */
export interface PropertyData {
  type: PropertyType;
  value: string; // e.g., "25", "US", "CFA"
  issuedAt: number; // Timestamp
  expiresAt: number; // Timestamp
  metadata: string; // Additional context
}

/**
 * Compute property commitment
 * H(propertyData, propertySecret)
 * Binds property data to a secret without revealing it
 */
export function computePropertyCommitment(
  propertyData: PropertyData,
  propertySecret: Uint8Array
): Uint8Array {
  const dataStr = JSON.stringify(propertyData);
  const hash = createHash('sha256');
  hash.update(Buffer.from(dataStr));
  hash.update(Buffer.from(propertySecret));
  return hash.digest();
}

/**
 * Compute proof commitment with domain separation
 * H(propertyCommitment, domainSeparator, nonce)
 * Domain separator ensures the same property can't be correlated across uses
 */
export function computeProofCommitment(
  propertyCommitment: Uint8Array,
  domainSeparator: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(propertyCommitment));
  hash.update(Buffer.from(domainSeparator));
  hash.update(Buffer.from(nonce));
  return hash.digest();
}

/**
 * Compute Merkle node hash from two children
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
 * Supports depth-20 trees (up to ~1M attestations)
 */
export class SparseMerkleTree {
  private depth: number;
  private leaves: Map<number, Uint8Array>;
  private root: Uint8Array;
  private defaultHashes: Uint8Array[];

  constructor(depth: number = MERKLE_DEPTH) {
    this.depth = depth;
    this.leaves = new Map();
    this.defaultHashes = this.computeDefaultHashes();
    this.root = this.defaultHashes[depth];
  }

  private computeDefaultHashes(): Uint8Array[] {
    const hashes: Uint8Array[] = [];
    let current = createHash('sha256')
      .update(Buffer.alloc(32, 0))
      .update(Buffer.alloc(32, 0))
      .digest();
    hashes.push(current);

    for (let i = 1; i <= this.depth; i++) {
      current = computeMerkleNode(hashes[i - 1], hashes[i - 1]);
      hashes.push(current);
    }

    return hashes;
  }

  addLeaf(index: number, leafHash: Uint8Array): Uint8Array {
    this.leaves.set(index, leafHash);
    this.root = this.computeRoot();
    return this.root;
  }

  getProof(index: number): Uint8Array[] {
    const siblings: Uint8Array[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.depth; level++) {
      const isRight = (currentIndex >> level) & 1;
      const siblingIndex = isRight ? currentIndex - (1 << level) : currentIndex + (1 << level);
      const siblingHash = this.leaves.get(siblingIndex) || this.defaultHashes[level];
      siblings.push(siblingHash);
    }

    return siblings;
  }

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

    return Buffer.from(currentHash).equals(Buffer.from(root));
  }

  private computeRoot(): Uint8Array {
    let currentLevel: Map<number, Uint8Array> = new Map(this.leaves);

    for (let level = 0; level < this.depth; level++) {
      const nextLevel: Map<number, Uint8Array> = new Map();
      const indices = new Set([...currentLevel.keys()]);
      
      for (const idx of indices) {
        const siblingIdx = (idx % 2 === 0) ? idx + 1 : idx - 1;
        indices.add(siblingIdx);
      }

      for (const idx of indices) {
        if (idx % 2 === 0) {
          const left = currentLevel.get(idx) || this.defaultHashes[level];
          const right = currentLevel.get(idx + 1) || this.defaultHashes[level];
          nextLevel.set(idx >> 1, computeMerkleNode(left, right));
        }
      }

      currentLevel = nextLevel;
    }

    return currentLevel.get(0) || this.defaultHashes[this.depth];
  }

  getRoot(): Uint8Array {
    return this.root;
  }

  getLeafCount(): number {
    return this.leaves.size;
  }
}

/**
 * Witness generation for proveProperty circuit
 */
export interface PropertyProofWitness {
  propertyData: PropertyData;
  propertySecret: Uint8Array;
  propertyIndex: number;
  siblings: Uint8Array[]; // 20 sibling hashes
  domainSeparator: Uint8Array;
  propertyCommitment: Uint8Array;
  proofCommitment: Uint8Array;
}

export function createPropertyProofWitness(
  propertyData: PropertyData,
  propertySecret: Uint8Array,
  propertyIndex: number,
  tree: SparseMerkleTree,
  domainSeparator: Uint8Array
): PropertyProofWitness {
  // Compute property commitment
  const propertyCommitment = computePropertyCommitment(propertyData, propertySecret);
  
  // Get Merkle proof
  const siblings = tree.getProof(propertyIndex);
  
  // Generate nonce for this proof
  const nonce = randomBytes(32);
  
  // Compute proof commitment with domain separation
  const proofCommitment = computeProofCommitment(propertyCommitment, domainSeparator, nonce);

  return {
    propertyData,
    propertySecret,
    propertyIndex,
    siblings,
    domainSeparator,
    propertyCommitment,
    proofCommitment,
  };
}

/**
 * Witness generation for updateAttestationRoot circuit
 */
export interface AuthorityUpdateWitness {
  authoritySecret: Uint8Array;
  authorityCommitment: Uint8Array;
}

export function createAuthorityUpdateWitness(
  authoritySecret: Uint8Array
): AuthorityUpdateWitness {
  const hash = createHash('sha256');
  hash.update(Buffer.from(authoritySecret));
  hash.update(Buffer.from([0xAA])); // Authority domain suffix
  const authorityCommitment = hash.digest();

  return {
    authoritySecret,
    authorityCommitment,
  };
}

/**
 * Generate domain separator for a specific property type
 * Different property types get different domain separators
 * This ensures cross-property unlinkability
 */
export function generateDomainSeparator(propertyType: PropertyType): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(propertyType));
  hash.update(Buffer.from('midnight-compliance-attestation'));
  return hash.digest();
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
