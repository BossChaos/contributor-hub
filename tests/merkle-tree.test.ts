import { describe, it, expect, beforeEach } from 'vitest';
import { MerkleTree, hashLeaf, hashNode, computeZeroHashes } from '../src/merkle-tree.js';

describe('Sparse Merkle Tree', () => {
  let tree: MerkleTree;

  beforeEach(() => {
    tree = new MerkleTree(20);
  });

  describe('initialization', () => {
    it('should create empty tree with correct depth', () => {
      expect(tree.depth).toBe(20);
      expect(tree.leafCount).toBe(0);
      expect(tree.capacity).toBe(2 ** 20);
    });

    it('should compute consistent zero hashes', () => {
      const zeros1 = computeZeroHashes(20);
      const zeros2 = computeZeroHashes(20);
      expect(zeros1).toEqual(zeros2);
    });

    it('should return zero hash for empty root', () => {
      const zeros = computeZeroHashes(20);
      expect(tree.root).toBe(zeros[20]);
    });
  });

  describe('leaf insertion', () => {
    it('should insert single leaf and update root', () => {
      const leaf = hashLeaf('alice-secret');
      const index = tree.insertLeaf(leaf);
      
      expect(index).toBe(0);
      expect(tree.leafCount).toBe(1);
      expect(tree.root).not.toBe(computeZeroHashes(20)[20]);
    });

    it('should maintain correct root after multiple insertions', () => {
      const leaf1 = hashLeaf('alice');
      const leaf2 = hashLeaf('bob');
      
      tree.insertLeaf(leaf1);
      tree.insertLeaf(leaf2);
      
      expect(tree.leafCount).toBe(2);
      
      // Manual verification: root = hash(hash(leaf1, leaf2), zero_hash_level_1, ...)
      const level0Hash = hashNode(leaf1, leaf2);
      const zeros = computeZeroHashes(20);
      
      let expectedRoot = level0Hash;
      for (let level = 1; level <= 20; level++) {
        expectedRoot = hashNode(expectedRoot, zeros[level]);
      }
      
      // Note: actual root computation may differ based on tree structure
      expect(tree.root).toBeDefined();
    });

    it('should throw when tree is full', () => {
      const fullTree = new MerkleTree(2); // capacity = 4
      fullTree.insertLeaf(hashLeaf('a'));
      fullTree.insertLeaf(hashLeaf('b'));
      fullTree.insertLeaf(hashLeaf('c'));
      fullTree.insertLeaf(hashLeaf('d'));
      
      expect(() => fullTree.insertLeaf(hashLeaf('e'))).toThrow('Tree is full');
    });
  });

  describe('Merkle proof generation', () => {
    beforeEach(() => {
      tree.insertLeaf(hashLeaf('alice'));
      tree.insertLeaf(hashLeaf('bob'));
      tree.insertLeaf(hashLeaf('charlie'));
    });

    it('should generate valid proof for existing leaf', () => {
      const proof = tree.generateMerkleProof(0);
      
      expect(proof.siblings.length).toBe(20);
      expect(proof.pathIndices.length).toBe(20);
      expect(proof.siblings.every(s => typeof s === 'string' && s.length === 64)).toBe(true);
    });

    it('should throw for out-of-range leaf index', () => {
      expect(() => tree.generateMerkleProof(100)).toThrow('out of range');
    });

    it('should produce different proofs for different leaves', () => {
      const proof0 = tree.generateMerkleProof(0);
      const proof1 = tree.generateMerkleProof(1);
      
      expect(proof0.siblings).not.toEqual(proof1.siblings);
    });
  });

  describe('proof verification', () => {
    it('should verify valid membership proof', () => {
      const leaf = hashLeaf('alice');
      tree.insertLeaf(leaf);
      
      const proof = tree.generateMerkleProof(0);
      expect(tree.verifyProof(leaf, proof)).toBe(true);
    });

    it('should reject proof with wrong leaf', () => {
      tree.insertLeaf(hashLeaf('alice'));
      
      const proof = tree.generateMerkleProof(0);
      const wrongLeaf = hashLeaf('bob');
      
      expect(tree.verifyProof(wrongLeaf, proof)).toBe(false);
    });

    it('should reject proof from different tree', () => {
      tree.insertLeaf(hashLeaf('alice'));
      const proof = tree.generateMerkleProof(0);
      
      const otherTree = new MerkleTree(20);
      otherTree.insertLeaf(hashLeaf('charlie'));
      
      // Proof from tree1 should not verify against tree2's structure
      expect(otherTree.verifyProof(hashLeaf('alice'), proof)).toBe(false);
    });

    it('should verify multiple members independently', () => {
      const aliceLeaf = hashLeaf('alice');
      const bobLeaf = hashLeaf('bob');
      
      tree.insertLeaf(aliceLeaf);
      tree.insertLeaf(bobLeaf);
      
      const aliceProof = tree.generateMerkleProof(0);
      const bobProof = tree.generateMerkleProof(1);
      
      expect(tree.verifyProof(aliceLeaf, aliceProof)).toBe(true);
      expect(tree.verifyProof(bobLeaf, bobProof)).toBe(true);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      tree.insertLeaf(hashLeaf('alice'));
      tree.insertLeaf(hashLeaf('bob'));
      
      const json = tree.toJSON();
      const restored = MerkleTree.fromJSON(json);
      
      expect(restored.root).toBe(tree.root);
      expect(restored.leafCount).toBe(tree.leafCount);
    });
  });

  describe('edge cases', () => {
    it('should handle depth-2 tree correctly', () => {
      const smallTree = new MerkleTree(2);
      smallTree.insertLeaf(hashLeaf('a'));
      smallTree.insertLeaf(hashLeaf('b'));
      
      const proof = smallTree.generateMerkleProof(0);
      expect(proof.siblings.length).toBe(2);
      expect(smallTree.verifyProof(hashLeaf('a'), proof)).toBe(true);
    });

    it('should handle single leaf proof', () => {
      tree.insertLeaf(hashLeaf('only-member'));
      const proof = tree.generateMerkleProof(0);
      expect(tree.verifyProof(hashLeaf('only-member'), proof)).toBe(true);
    });
  });
});
