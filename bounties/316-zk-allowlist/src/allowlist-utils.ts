// This file is part of Midnight Contributor Hub - ZK Allowlist Tutorial.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * ZK Allowlist Utilities
 * ======================
 * 
 * Core logic for membership proof generation, verification, and
 * nullifier management. This module bridges the Compact contract
 * with the TypeScript SDK.
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────┐
 * │ User Secret (s)                                         │
 * │     ↓ hashLeaf()                                        │
 * │ Leaf Hash (h) → Merkle Tree → Root (r)                  │
 * │     ↓ getMerklePath()                                   │
 * │ Path (p) → ZK Circuit → Proof (π)                       │
 * │     ↓ hashNullifier(s, ctx, h)                          │
 * │ Nullifier (ν) → On-chain Set → Replay Protection         │
 * └─────────────────────────────────────────────────────────┘
 */

import { 
    SparseMerkleTree, 
    MerklePath, 
    hashLeaf, 
    hashNullifier 
} from "./merkle-tree.js";

// ============================================================================
// Type Definitions
// ============================================================================

/** Generated ZK proof with all inputs needed for on-chain verification */
export interface ZKProof {
    /** Hex-encoded ZK proof string */
    proof: string;
    /** Current Merkle root (public input) */
    merkleRoot: string;
    /** Nullifier (prevents replay, doesn't reveal identity) */
    nullifier: string;
    /** Leaf hash (committed, not revealed in proof) */
    leafHash: string;
}

/** Proof verification result */
export interface VerificationResult {
    valid: boolean;
    checks: {
        proofDecoded: boolean;
        rootMatches: boolean;
        nullifierValid: boolean;
        leafValid: boolean;
    };
    errors: string[];
}

// ============================================================================
// Proof Generation
// ============================================================================

/**
 * Generates a zero-knowledge membership proof.
 * 
 * The prover demonstrates knowledge of a valid Merkle path without
 * revealing which leaf they know. The nullifier ensures one-time use.
 * 
 * @param tree - Sparse Merkle tree containing the member
 * @param secret - Prover's private secret
 * @param context - Application context (e.g., "voting_round_1")
 * @returns ZKProof ready for on-chain submission
 * @throws If secret is not in the tree
 * 
 * @example
 * ```typescript
 * const tree = new SparseMerkleTree(20);
 * tree.insertLeaf(hashLeaf(new TextEncoder().encode("alice")));
 * 
 * const proof = generateProof(
 *     tree,
 *     new TextEncoder().encode("alice"),
 *     new TextEncoder().encode("election_2026")
 * );
 * console.log(proof.nullifier); // One-time identifier
 * ```
 */
export function generateProof(
    tree: SparseMerkleTree,
    secret: Uint8Array,
    context: Uint8Array
): ZKProof {
    const leafHash = hashLeaf(secret);
    const index = tree.findLeafIndex(leafHash);
    
    if (index === -1) {
        throw new Error("Secret not found in tree. Add member first.");
    }
    
    // Get Merkle path (witness data)
    const path = tree.getMerklePath(index);
    
    // Compute nullifier: H(secret || context || leaf)
    const nullifier = hashNullifier(secret, context, leafHash);
    
    // In production, this would call the actual ZK prover:
    // const proof = await prove(path, leafHash, tree.getRoot());
    // For tutorial purposes, we simulate the proof structure.
    const simulatedProof = simulateZKProof(path, leafHash, tree.getRoot());
    
    return {
        proof: Buffer.from(simulatedProof).toString("hex"),
        merkleRoot: Buffer.from(tree.getRoot()).toString("hex"),
        nullifier: Buffer.from(nullifier).toString("hex"),
        leafHash: Buffer.from(leafHash).toString("hex")
    };
}

/**
 * Verifies a ZK proof locally (before on-chain submission).
 * 
 * Performs all checks that the contract will perform, plus additional
 * sanity checks for client-side validation.
 * 
 * @param proof - ZK proof to verify
 * @param tree - Current Merkle tree state
 * @param context - Same context used during proof generation
 * @param secret - Prover's secret (for nullifier recomputation)
 * @returns VerificationResult with detailed check results
 */
export function verifyProof(
    proof: ZKProof,
    tree: SparseMerkleTree,
    context: Uint8Array,
    secret: Uint8Array
): VerificationResult {
    const errors: string[] = [];
    
    // Check 1: Proof is valid hex
    const proofDecoded = isValidHex(proof.proof);
    if (!proofDecoded) errors.push("Proof is not valid hex");
    
    // Check 2: Root matches current tree state
    const rootMatches = proof.merkleRoot === 
        Buffer.from(tree.getRoot()).toString("hex");
    if (!rootMatches) errors.push("Root mismatch with current tree");
    
    // Check 3: Leaf hash matches secret
    const expectedLeaf = hashLeaf(secret);
    const leafValid = proof.leafHash === 
        Buffer.from(expectedLeaf).toString("hex");
    if (!leafValid) errors.push("Leaf hash doesn't match secret");
    
    // Check 4: Nullifier is correctly computed
    const expectedNullifier = hashNullifier(
        secret, context, expectedLeaf
    );
    const nullifierValid = proof.nullifier === 
        Buffer.from(expectedNullifier).toString("hex");
    if (!nullifierValid) errors.push("Nullifier computation mismatch");
    
    return {
        valid: errors.length === 0,
        checks: {
            proofDecoded,
            rootMatches,
            nullifierValid,
            leafValid
        },
        errors
    };
}

// ============================================================================
// Nullifier Management
// ============================================================================

/**
 * Nullifier tracker for replay protection.
 * 
 * In production, this state lives on-chain in the Compact contract's
 * `used_nullifiers` Set. This client-side tracker mirrors that state
 * for local verification.
 */
export class NullifierTracker {
    private used: Set<string>;

    constructor() {
        this.used = new Set();
    }

    /**
     * Checks if a nullifier has been used.
     * @param nullifier - 32-byte nullifier
     * @returns true if already consumed
     */
    isUsed(nullifier: Uint8Array): boolean {
        return this.used.has(Buffer.from(nullifier).toString("hex"));
    }

    /**
     * Records a nullifier as consumed.
     * @param nullifier - 32-byte nullifier
     * @throws If already consumed
     */
    consume(nullifier: Uint8Array): void {
        const key = Buffer.from(nullifier).toString("hex");
        if (this.used.has(key)) {
            throw new Error("Nullifier already consumed (replay detected)");
        }
        this.used.add(key);
    }

    /**
     * @returns Number of consumed nullifiers
     */
    get count(): number {
        return this.used.size;
    }

    /** Clears all tracked nullifiers (for testing) */
    reset(): void {
        this.used.clear();
    }
}

// ============================================================================
// Member Management
// ============================================================================

/**
 * Adds a member to the allowlist tree.
 * 
 * @param tree - Merkle tree to add to
 * @param secret - Member's secret
 * @returns Leaf index of new member
 * @throws If secret already in tree
 */
export function addMember(
    tree: SparseMerkleTree,
    secret: Uint8Array
): number {
    const leafHash = hashLeaf(secret);
    return tree.insertLeaf(leafHash);
}

/**
 * Checks if a secret is a member of the tree.
 * 
 * @param tree - Merkle tree
 * @param secret - Secret to check
 * @returns true if member exists
 */
export function isMember(
    tree: SparseMerkleTree,
    secret: Uint8Array
): boolean {
    const leafHash = hashLeaf(secret);
    return tree.findLeafIndex(leafHash) !== -1;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Simulates ZK proof generation for tutorial purposes.
 * 
 * In production, this would use the actual Midnight proof server
 * to generate a real PLONK proof. The proof string would be
 * verified by the on-chain verifier.
 * 
 * @param path - Merkle path (witness)
 * @param leaf - Leaf hash
 * @param root - Merkle root
 * @returns Simulated proof bytes
 */
function simulateZKProof(
    path: MerklePath,
    leaf: Uint8Array,
    root: Uint8Array
): Uint8Array {
    // Simulated proof: in production, this is a PLONK proof
    // For tutorial, we concatenate path data to demonstrate structure
    const components = [leaf, root, ...path.siblings];
    const totalLength = components.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const comp of components) {
        result.set(comp, offset);
        offset += comp.length;
    }
    return result;
}

/** Checks if a string is valid hexadecimal */
function isValidHex(str: string): boolean {
    return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
}
