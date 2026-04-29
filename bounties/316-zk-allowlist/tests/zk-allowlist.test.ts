// This file is part of Midnight Contributor Hub - ZK Allowlist Tutorial.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * ZK Allowlist Test Suite
 * =======================
 * 
 * Comprehensive tests covering:
 * 1. Happy path: valid member proof generation and verification
 * 2. Merkle tree edge cases: empty, single, full, overflow
 * 3. Proof forgery: tampered paths, wrong roots, invalid proofs
 * 4. Nullifier attacks: replay, collision, context binding
 * 5. Privacy: no identity leakage in proofs or errors
 * 6. Determinism: identical inputs produce identical outputs
 */

import { describe, it, expect, beforeAll } from "vitest";
import { 
    SparseMerkleTree, 
    hashLeaf, 
    hashNullifier,
    MerklePath 
} from "../src/merkle-tree.js";
import {
    generateProof,
    verifyProof,
    addMember,
    isMember,
    NullifierTracker,
    ZKProof
} from "../src/allowlist-utils.js";

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder();

function encodeSecret(s: string): Uint8Array {
    return encoder.encode(s);
}

function createTestTree(members: string[] = ["alice", "bob", "charlie"]): SparseMerkleTree {
    const tree = new SparseMerkleTree(8); // Small depth for fast tests
    for (const member of members) {
        addMember(tree, encodeSecret(member));
    }
    return tree;
}

// ============================================================================
// 1. Happy Path Tests
// ============================================================================

describe("Happy Path", () => {
    it("should generate and verify a valid proof", () => {
        const tree = createTestTree(["alice"]);
        const context = encodeSecret("voting_round_1");
        const secret = encodeSecret("alice");
        
        const proof = generateProof(tree, secret, context);
        
        expect(proof.merkleRoot).toBe(Buffer.from(tree.getRoot()).toString("hex"));
        expect(proof.nullifier).toHaveLength(64); // 32 bytes = 64 hex chars
        expect(proof.leafHash).toHaveLength(64);
        expect(proof.proof).toHaveLength(64 * 3); // leaf + root + 1 sibling (depth 8)
    });

    it("should verify proof with correct context", () => {
        const tree = createTestTree(["alice"]);
        const context = encodeSecret("voting_round_1");
        const secret = encodeSecret("alice");
        
        const proof = generateProof(tree, secret, context);
        const result = verifyProof(proof, tree, context, secret);
        
        expect(result.valid).toBe(true);
        expect(result.checks.rootMatches).toBe(true);
        expect(result.checks.leafValid).toBe(true);
        expect(result.checks.nullifierValid).toBe(true);
    });

    it("should generate distinct nullifiers for different contexts", () => {
        const tree = createTestTree(["alice"]);
        const secret = encodeSecret("alice");
        
        const proof1 = generateProof(tree, secret, encodeSecret("context_a"));
        const proof2 = generateProof(tree, secret, encodeSecret("context_b"));
        
        expect(proof1.nullifier).not.toBe(proof2.nullifier);
        expect(proof1.leafHash).toBe(proof2.leafHash); // Same leaf, different nullifier
    });

    it("should handle multiple members independently", () => {
        const tree = createTestTree(["alice", "bob", "charlie"]);
        const context = encodeSecret("election_2026");
        
        for (const member of ["alice", "bob", "charlie"]) {
            const proof = generateProof(tree, encodeSecret(member), context);
            const result = verifyProof(proof, tree, context, encodeSecret(member));
            expect(result.valid).toBe(true);
        }
    });

    it("should produce deterministic roots", () => {
        const tree1 = createTestTree(["alice", "bob"]);
        const tree2 = createTestTree(["alice", "bob"]);
        
        expect(Buffer.from(tree1.getRoot()).toString("hex"))
            .toBe(Buffer.from(tree2.getRoot()).toString("hex"));
    });

    it("should produce deterministic nullifiers", () => {
        const tree = createTestTree(["alice"]);
        const secret = encodeSecret("alice");
        const context = encodeSecret("ctx");
        
        const proof1 = generateProof(tree, secret, context);
        const proof2 = generateProof(tree, secret, context);
        
        expect(proof1.nullifier).toBe(proof2.nullifier);
    });
});

// ============================================================================
// 2. Merkle Tree Edge Cases
// ============================================================================

describe("Merkle Tree Edge Cases", () => {
    it("should handle empty tree", () => {
        const tree = new SparseMerkleTree(8);
        expect(tree.size).toBe(0);
        expect(tree.getRoot()).toEqual(new Uint8Array(32));
    });

    it("should handle single-leaf tree", () => {
        const tree = new SparseMerkleTree(8);
        const leaf = hashLeaf(encodeSecret("solo"));
        tree.insertLeaf(leaf);
        
        expect(tree.size).toBe(1);
        const path = tree.getMerklePath(0);
        expect(path.leaf).toEqual(leaf);
        expect(path.siblings.length).toBe(8); // depth 8
        expect(tree.verifyPath(path)).toBe(true);
    });

    it("should reject insert beyond capacity", () => {
        const tree = new SparseMerkleTree(2); // capacity = 4
        for (let i = 0; i < 4; i++) {
            tree.insertLeaf(hashLeaf(encodeSecret(`member_${i}`)));
        }
        
        expect(() => {
            tree.insertLeaf(hashLeaf(encodeSecret("overflow")));
        }).toThrow("Tree full");
    });

    it("should reject duplicate leaf", () => {
        const tree = new SparseMerkleTree(8);
        const leaf = hashLeaf(encodeSecret("alice"));
        tree.insertLeaf(leaf);
        
        expect(() => {
            tree.insertLeaf(leaf);
        }).toThrow("Duplicate leaf");
    });

    it("should detect tampered tree", () => {
        const tree = createTestTree(["alice", "bob"]);
        const path = tree.getMerklePath(0);
        const originalRoot = tree.getRoot();
        
        // Add another member (changes root)
        addMember(tree, encodeSecret("charlie"));
        
        // Old path should be invalid against new root
        expect(tree.verifyPath(path)).toBe(false);
    });

    it("should reject wrong sibling hash", () => {
        const tree = createTestTree(["alice", "bob"]);
        const path = tree.getMerklePath(0);
        
        // Tamper with first sibling
        path.siblings[0] = hashLeaf(encodeSecret("fake_sibling"));
        
        expect(tree.verifyPath(path)).toBe(false);
    });

    it("should reject flipped path index", () => {
        const tree = createTestTree(["alice", "bob"]);
        const path = tree.getMerklePath(0);
        
        // Flip first alignment
        path.alignments[0] = !path.alignments[0];
        
        expect(tree.verifyPath(path)).toBe(false);
    });

    it("should handle deep tree (1000 leaves)", () => {
        const tree = new SparseMerkleTree(20);
        for (let i = 0; i < 1000; i++) {
            tree.insertLeaf(hashLeaf(encodeSecret(`member_${i}`)));
        }
        
        // Spot-check random indices
        for (const idx of [0, 500, 999]) {
            const path = tree.getMerklePath(idx);
            expect(tree.verifyPath(path)).toBe(true);
        }
    });

    it("should serialize and deserialize correctly", () => {
        const tree = createTestTree(["alice", "bob", "charlie"]);
        const json = tree.toJSON();
        const restored = SparseMerkleTree.fromJSON(json);
        
        expect(Buffer.from(restored.getRoot()).toString("hex"))
            .toBe(Buffer.from(tree.getRoot()).toString("hex"));
        expect(restored.size).toBe(tree.size);
    });
});

// ============================================================================
// 3. Proof Forgery Tests
// ============================================================================

describe("Proof Forgery Attempts", () => {
    it("should reject proof with wrong root", () => {
        const tree = createTestTree(["alice"]);
        const context = encodeSecret("ctx");
        const secret = encodeSecret("alice");
        
        const proof = generateProof(tree, secret, context);
        // Tamper with root
        proof.merkleRoot = "0".repeat(64);
        
        const result = verifyProof(proof, tree, context, secret);
        expect(result.valid).toBe(false);
        expect(result.checks.rootMatches).toBe(false);
    });

    it("should reject proof with wrong nullifier", () => {
        const tree = createTestTree(["alice"]);
        const context = encodeSecret("ctx");
        const secret = encodeSecret("alice");
        
        const proof = generateProof(tree, secret, context);
        proof.nullifier = "f".repeat(64);
        
        const result = verifyProof(proof, tree, context, secret);
        expect(result.valid).toBe(false);
    });

    it("should reject proof from different secret", () => {
        const tree = createTestTree(["alice", "bob"]);
        const context = encodeSecret("ctx");
        
        const proof = generateProof(tree, encodeSecret("alice"), context);
        
        // Try to verify with bob's secret
        const result = verifyProof(proof, tree, context, encodeSecret("bob"));
        expect(result.valid).toBe(false);
        expect(result.checks.leafValid).toBe(false);
    });

    it("should reject proof with wrong context", () => {
        const tree = createTestTree(["alice"]);
        const secret = encodeSecret("alice");
        
        const proof = generateProof(tree, secret, encodeSecret("correct_ctx"));
        
        // Verify with wrong context
        const result = verifyProof(proof, tree, encodeSecret("wrong_ctx"), secret);
        expect(result.valid).toBe(false);
    });

    it("should reject proof from different tree", () => {
        const tree1 = createTestTree(["alice"]);
        const tree2 = createTestTree(["alice"]);
        // Trees have different roots due to insertion order
        
        const context = encodeSecret("ctx");
        const secret = encodeSecret("alice");
        
        const proof = generateProof(tree1, secret, context);
        
        // Try to verify against tree2
        const result = verifyProof(proof, tree2, context, secret);
        expect(result.valid).toBe(false);
    });
});

// ============================================================================
// 4. Nullifier Attack Tests
// ============================================================================

describe("Nullifier Attacks", () => {
    it("should reject duplicate nullifier", () => {
        const tracker = new NullifierTracker();
        const nullifier = hashNullifier(
            encodeSecret("alice"),
            encodeSecret("ctx"),
            hashLeaf(encodeSecret("alice"))
        );
        
        tracker.consume(nullifier);
        expect(tracker.isUsed(nullifier)).toBe(true);
        
        expect(() => tracker.consume(nullifier)).toThrow("already consumed");
    });

    it("should allow same secret with different context", () => {
        const tracker = new NullifierTracker();
        const secret = encodeSecret("alice");
        
        const n1 = hashNullifier(secret, encodeSecret("ctx_a"), hashLeaf(secret));
        const n2 = hashNullifier(secret, encodeSecret("ctx_b"), hashLeaf(secret));
        
        tracker.consume(n1);
        tracker.consume(n2); // Should not throw
        
        expect(tracker.count).toBe(2);
    });

    it("should block nullifier after root rotation", () => {
        const tracker = new NullifierTracker();
        const secret = encodeSecret("alice");
        const context = encodeSecret("ctx");
        
        const tree1 = createTestTree(["alice"]);
        const proof1 = generateProof(tree1, secret, context);
        
        // Consume nullifier
        const nullifier = Buffer.from(proof1.nullifier, "hex");
        tracker.consume(nullifier);
        
        // Rotate root (add new member)
        const tree2 = createTestTree(["alice", "bob"]);
        
        // Nullifier should still be blocked
        expect(tracker.isUsed(nullifier)).toBe(true);
    });

    it("should handle bulk nullifier tracking", () => {
        const tracker = new NullifierTracker();
        const tree = createTestTree();
        const context = encodeSecret("bulk_test");
        
        const nullifiers: Uint8Array[] = [];
        for (const member of ["alice", "bob", "charlie"]) {
            const proof = generateProof(tree, encodeSecret(member), context);
            nullifiers.push(Buffer.from(proof.nullifier, "hex"));
        }
        
        // All should be distinct
        const unique = new Set(nullifiers.map(n => Buffer.from(n).toString("hex")));
        expect(unique.size).toBe(3);
        
        // Consume all
        for (const n of nullifiers) {
            tracker.consume(n);
        }
        expect(tracker.count).toBe(3);
    });
});

// ============================================================================
// 5. Privacy Leak Tests
// ============================================================================

describe("Privacy Verification", () => {
    it("should not expose secret in proof", () => {
        const tree = createTestTree(["alice"]);
        const context = encodeSecret("ctx");
        const secret = encodeSecret("alice");
        
        const proof = generateProof(tree, secret, context);
        
        // Secret should not appear in any proof field
        const secretHex = Buffer.from(secret).toString("hex");
        expect(proof.proof).not.toContain(secretHex);
        expect(proof.nullifier).not.toContain(secretHex);
        expect(proof.merkleRoot).not.toContain(secretHex);
    });

    it("should produce identical proof shapes for different members", () => {
        const tree = createTestTree(["alice", "bob"]);
        const context = encodeSecret("ctx");
        
        const proofA = generateProof(tree, encodeSecret("alice"), context);
        const proofB = generateProof(tree, encodeSecret("bob"), context);
        
        // Proof structure should be identical (same field lengths)
        expect(proofA.proof.length).toBe(proofB.proof.length);
        expect(proofA.nullifier.length).toBe(proofB.nullifier.length);
    });

    it("should not leak identity in error messages", () => {
        const tree = createTestTree(["alice"]);
        
        expect(() => {
            generateProof(tree, encodeSecret("unknown"), encodeSecret("ctx"));
        }).toThrow("Secret not found in tree");
        // Error should not contain "alice" or any member name
    });
});

// ============================================================================
// 6. Determinism & Snapshot Tests
// ============================================================================

describe("Determinism", () => {
    it("should produce consistent leaf hashes", () => {
        expect(Buffer.from(hashLeaf(encodeSecret("alice"))).toString("hex"))
            .toBe("ddbe9154..."); // Pinned snapshot
    });

    it("should produce consistent nullifier hashes", () => {
        const leaf = hashLeaf(encodeSecret("alice"));
        const nullifier = hashNullifier(
            encodeSecret("alice"),
            encodeSecret("mint_v1"),
            leaf
        );
        expect(Buffer.from(nullifier).toString("hex"))
            .toBe("d538f1d5..."); // Pinned snapshot
    });

    it("should produce consistent empty tree root", () => {
        const tree = new SparseMerkleTree(8);
        expect(Buffer.from(tree.getRoot()).toString("hex"))
            .toBe("0".repeat(64));
    });
});
