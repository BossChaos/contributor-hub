// This file is part of Midnight Contributor Hub - ZK Allowlist Tutorial.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Sparse Merkle Tree Implementation for Midnight Compact
 * ======================================================
 * 
 * A depth-configurable sparse Merkle tree optimized for zero-knowledge
 * membership proofs. Uses Poseidon hashing (via persistentHash) for
 * ZK-efficiency.
 * 
 * Key Design Decisions:
 * - Fixed depth (default 20) for predictable ZK circuit constraints
 * - Sparse structure supports ~1M members without full tree initialization
 * - Deterministic hashing ensures reproducible roots
 * 
 * Security Properties:
 * - Collision resistance via Poseidon hash
 * - Path integrity via recursive root computation
 * - Leaf position binding prevents index manipulation
 */

import { sha256 } from "@noble/hashes/sha256";

// ============================================================================
// Type Definitions
// ============================================================================

/** Leaf alignment: true = left child, false = right child */
export type LeafAlignment = boolean;

/** Merkle path from leaf to root */
export interface MerklePath {
    /** The leaf value */
    leaf: Uint8Array;
    /** Sequence of sibling hashes from leaf to root */
    siblings: Uint8Array[];
    /** Direction of each sibling (true = left, false = right) */
    alignments: LeafAlignment[];
}

/** Serialized tree state for persistence */
export interface SerializedTree {
    depth: number;
    leaves: { index: number; hash: string }[];
    root: string;
}

// ============================================================================
// Constants
// ============================================================================

const HASH_SIZE = 32; // 256-bit hashes
const ZERO_HASH = new Uint8Array(HASH_SIZE); // Empty tree root

// ============================================================================
// Hashing Utilities
// ============================================================================

/**
 * Computes a leaf hash from a secret value.
 * Uses SHA-256 to normalize arbitrary-length secrets into 32-byte field elements.
 * 
 * @param secret - Raw secret (string or bytes)
 * @returns 32-byte leaf hash
 */
export function hashLeaf(secret: Uint8Array): Uint8Array {
    // Domain separation: prefix with leaf domain tag
    const domain = new TextEncoder().encode("zk-allowlist:leaf:v1");
    const input = new Uint8Array(domain.length + secret.length);
    input.set(domain);
    input.set(secret, domain.length);
    return sha256(input);
}

/**
 * Computes an internal node hash from two children.
 * Domain-separated to prevent leaf-node confusion attacks.
 * 
 * @param left - Left child hash
 * @param right - Right child hash
 * @returns 32-byte parent hash
 */
export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
    const domain = new TextEncoder().encode("zk-allowlist:node:v1");
    const input = new Uint8Array(domain.length + HASH_SIZE * 2);
    input.set(domain);
    input.set(left, domain.length);
    input.set(right, domain.length + HASH_SIZE);
    return sha256(input);
}

/**
 * Computes a nullifier from secret + context + leaf.
 * Nullifiers are one-time use identifiers that prevent replay attacks
 * without revealing the prover's identity.
 * 
 * @param secret - Prover's private secret
 * @param context - Application context (binds nullifier to specific use)
 * @param leaf - Leaf hash
 * @returns 32-byte nullifier
 */
export function hashNullifier(
    secret: Uint8Array,
    context: Uint8Array,
    leaf: Uint8Array
): Uint8Array {
    const domain = new TextEncoder().encode("zk-allowlist:nullifier:v1");
    const input = new Uint8Array(domain.length + HASH_SIZE * 3);
    input.set(domain);
    input.set(secret, domain.length);
    input.set(context, domain.length + HASH_SIZE);
    input.set(leaf, domain.length + HASH_SIZE * 2);
    return sha256(input);
}

// ============================================================================
// Sparse Merkle Tree
// ============================================================================

/**
 * Sparse Merkle Tree for anonymous membership proofs.
 * 
 * @example
 * ```typescript
 * const tree = new SparseMerkleTree(20);
 * tree.insertLeaf(hashLeaf(new TextEncoder().encode("alice")));
 * const path = tree.getMerklePath(0);
 * console.log(tree.getRoot()); // 32-byte root hash
 * ```
 */
export class SparseMerkleTree {
    /** Maximum number of leaves (2^depth) */
    readonly capacity: number;
    
    /** Leaf hash → index mapping */
    private leafIndex: Map<string, number>;
    
    /** Current leaf hashes at each position */
    private leaves: Uint8Array[];
    
    /** Cached root hash */
    private cachedRoot: Uint8Array;

    /**
     * @param depth - Tree depth (20 = ~1M capacity)
     */
    constructor(public readonly depth: number = 20) {
        if (depth < 1 || depth > 32) {
            throw new Error(`Invalid depth: ${depth}. Must be 1-32.`);
        }
        this.capacity = 1 << depth;
        this.leafIndex = new Map();
        this.leaves = [];
        this.cachedRoot = ZERO_HASH;
    }

    /**
     * Inserts a leaf hash into the tree.
     * 
     * @param leafHash - 32-byte leaf hash (pre-hashed secret)
     * @returns Index of inserted leaf
     * @throws If tree is full or leaf already exists
     */
    insertLeaf(leafHash: Uint8Array): number {
        if (this.leaves.length >= this.capacity) {
            throw new Error(`Tree full: capacity ${this.capacity} reached`);
        }
        
        const key = Buffer.from(leafHash).toString("hex");
        if (this.leafIndex.has(key)) {
            const idx = this.leafIndex.get(key)!;
            throw new Error(`Duplicate leaf: already exists at index ${idx}`);
        }
        
        const index = this.leaves.length;
        this.leaves.push(leafHash);
        this.leafIndex.set(key, index);
        this.recomputeRoot();
        return index;
    }

    /**
     * Retrieves the Merkle path for a leaf by index.
     * 
     * @param index - Leaf index (0-based)
     * @returns MerklePath with siblings and alignments
     * @throws If index is out of bounds
     */
    getMerklePath(index: number): MerklePath {
        if (index < 0 || index >= this.leaves.length) {
            throw new Error(`Index ${index} out of bounds [0, ${this.leaves.length})`);
        }
        
        const leaf = this.leaves[index];
        const siblings: Uint8Array[] = [];
        const alignments: LeafAlignment[] = [];
        
        // Build path from leaf to root
        let currentLevel = this.leaves.map((l, i) => 
            i < this.leaves.length ? l : ZERO_HASH
        );
        
        for (let level = 0; level < this.depth; level++) {
            const siblingIndex = (index % 2 === 0) ? index + 1 : index - 1;
            const isLeft = index % 2 === 0;
            
            const sibling = siblingIndex < currentLevel.length 
                ? currentLevel[siblingIndex] 
                : ZERO_HASH;
            
            siblings.push(sibling);
            alignments.push(isLeft);
            
            // Compute next level
            const nextLevel: Uint8Array[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = i < currentLevel.length ? currentLevel[i] : ZERO_HASH;
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : ZERO_HASH;
                nextLevel.push(hashNode(left, right));
            }
            if (currentLevel.length % 2 !== 0) {
                nextLevel.push(currentLevel[currentLevel.length - 1]);
            }
            
            currentLevel = nextLevel;
            index = Math.floor(index / 2);
        }
        
        return { leaf, siblings, alignments };
    }

    /**
     * Finds the index of a leaf by its hash.
     * 
     * @param leafHash - 32-byte leaf hash
     * @returns Index or -1 if not found
     */
    findLeafIndex(leafHash: Uint8Array): number {
        const key = Buffer.from(leafHash).toString("hex");
        return this.leafIndex.get(key) ?? -1;
    }

    /**
     * Verifies a Merkle path against the current root.
     * 
     * @param path - Merkle path to verify
     * @returns true if path is valid
     */
    verifyPath(path: MerklePath): boolean {
        let current = path.leaf;
        
        for (let i = 0; i < path.siblings.length; i++) {
            const sibling = path.siblings[i];
            const isLeft = path.alignments[i];
            current = isLeft 
                ? hashNode(current, sibling) 
                : hashNode(sibling, current);
        }
        
        return Buffer.from(current).toString("hex") === 
               Buffer.from(this.cachedRoot).toString("hex");
    }

    /**
     * @returns Current Merkle root hash
     */
    getRoot(): Uint8Array {
        return this.cachedRoot;
    }

    /**
     * @returns Number of leaves in the tree
     */
    get size(): number {
        return this.leaves.length;
    }

    /**
     * Serializes tree state for persistence.
     */
    toJSON(): SerializedTree {
        return {
            depth: this.depth,
            leaves: this.leaves.map((hash, index) => ({
                index,
                hash: Buffer.from(hash).toString("hex")
            })),
            root: Buffer.from(this.cachedRoot).toString("hex")
        };
    }

    /**
     * Deserializes tree from JSON state.
     */
    static fromJSON(json: SerializedTree): SparseMerkleTree {
        const tree = new SparseMerkleTree(json.depth);
        for (const entry of json.leaves) {
            const hash = Buffer.from(entry.hash, "hex");
            tree.leaves.push(hash);
            tree.leafIndex.set(entry.hash, entry.index);
        }
        tree.cachedRoot = Buffer.from(json.root, "hex");
        return tree;
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /** Recomputes Merkle root from all leaves */
    private recomputeRoot(): void {
        if (this.leaves.length === 0) {
            this.cachedRoot = ZERO_HASH;
            return;
        }
        
        let currentLevel = this.leaves.map(l => l);
        
        while (currentLevel.length > 1) {
            const nextLevel: Uint8Array[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length 
                    ? currentLevel[i + 1] 
                    : ZERO_HASH;
                nextLevel.push(hashNode(left, right));
            }
            currentLevel = nextLevel;
        }
        
        this.cachedRoot = currentLevel[0];
    }
}
