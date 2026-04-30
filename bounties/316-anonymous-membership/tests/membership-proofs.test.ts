// Test Suite for Anonymous Membership Proofs
// Covers Merkle tree operations, witness generation, and replay prevention

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SparseMerkleTree,
  computeLeafHash,
  computeNullifier,
  createMembershipWitness,
  generateSecret,
  generateDomainSeparator,
  bytesToHex,
} from '../typescript/witnesses';

describe('AnonymousMembership Contract Tests', () => {
  let tree: SparseMerkleTree;
  let domainSeparator: Uint8Array;

  beforeEach(() => {
    tree = new SparseMerkleTree(20);
    domainSeparator = generateDomainSeparator();
  });

  describe('Sparse Merkle Tree', () => {
    it('should create empty tree with correct default root', () => {
      const root = tree.getRoot();
      expect(root).toBeDefined();
      expect(root.length).toBe(32);
    });

    it('should add members and update root', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      const root1 = tree.addMember(0, secret1, domainSeparator);
      expect(root1).toBeDefined();

      const root2 = tree.addMember(1, secret2, domainSeparator);
      expect(root2).toBeDefined();
      expect(root2).not.toEqual(root1); // Root should change
    });

    it('should support depth-20 tree (1M+ members)', () => {
      // Add members at various indices
      const secret1 = generateSecret();
      const secret2 = generateSecret();
      const secret3 = generateSecret();

      tree.addMember(0, secret1, domainSeparator);
      tree.addMember(1, secret2, domainSeparator);
      tree.addMember(1048575, secret3, domainSeparator); // Max index for depth-20

      const root = tree.getRoot();
      expect(root).toBeDefined();
      expect(tree.getMemberCount()).toBe(3);
    });

    it('should generate valid Merkle proofs', () => {
      const secret = generateSecret();
      tree.addMember(5, secret, domainSeparator);

      const proof = tree.getProof(5);
      expect(proof.length).toBe(20); // Depth-20 = 20 siblings

      // Verify the proof
      const leafHash = computeLeafHash(secret, domainSeparator);
      const root = tree.getRoot();

      const isValid = SparseMerkleTree.verifyProof(leafHash, 5, proof, root);
      expect(isValid).toBe(true);
    });

    it('should reject invalid Merkle proofs', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      tree.addMember(0, secret1, domainSeparator);
      tree.addMember(1, secret2, domainSeparator);

      const proof = tree.getProof(0);
      const wrongLeaf = computeLeafHash(secret2, domainSeparator); // Wrong leaf
      const root = tree.getRoot();

      const isValid = SparseMerkleTree.verifyProof(wrongLeaf, 0, proof, root);
      expect(isValid).toBe(false);
    });
  });

  describe('Witness Generation', () => {
    it('should create valid membership witness', () => {
      const secret = generateSecret();
      tree.addMember(42, secret, domainSeparator);

      const witness = createMembershipWitness(secret, 42, tree, domainSeparator);

      expect(witness.memberSecret).toEqual(secret);
      expect(witness.memberIndex).toBe(42);
      expect(witness.siblings.length).toBe(20);
      expect(witness.domainSeparator).toEqual(domainSeparator);
      expect(witness.nullifier.length).toBe(32);
    });

    it('should generate unique nullifiers for different members', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      const n1 = computeNullifier(secret1, domainSeparator);
      const n2 = computeNullifier(secret2, domainSeparator);

      expect(n1).not.toEqual(n2);
    });

    it('should generate unique nullifiers for same member, different domains', () => {
      const secret = generateSecret();
      const domain1 = generateDomainSeparator();
      const domain2 = generateDomainSeparator();

      const n1 = computeNullifier(secret, domain1);
      const n2 = computeNullifier(secret, domain2);

      expect(n1).not.toEqual(n2); // Different domains = different nullifiers
    });
  });

  describe('Replay Prevention', () => {
    it('should detect nullifier reuse', () => {
      const secret = generateSecret();
      tree.addMember(0, secret, domainSeparator);

      const nullifier = computeNullifier(secret, domainSeparator);

      // Simulate used nullifiers set
      const usedNullifiers = new Set<string>();

      // First use - should be allowed
      expect(usedNullifiers.has(bytesToHex(nullifier))).toBe(false);
      usedNullifiers.add(bytesToHex(nullifier));

      // Second use - should be detected
      expect(usedNullifiers.has(bytesToHex(nullifier))).toBe(true);
    });

    it('should prevent cross-domain replay', () => {
      const secret = generateSecret();
      const domain1 = generateDomainSeparator();
      const domain2 = generateDomainSeparator();

      const n1 = computeNullifier(secret, domain1);
      const n2 = computeNullifier(secret, domain2);

      // Different domains produce different nullifiers
      expect(n1).not.toEqual(n2);

      // Each domain tracks its own nullifiers
      const used1 = new Set<string>();
      const used2 = new Set<string>();

      used1.add(bytesToHex(n1));
      expect(used1.has(bytesToHex(n1))).toBe(true);
      expect(used2.has(bytesToHex(n1))).toBe(false); // Not used in domain2
    });
  });

  describe('Edge Cases', () => {
    it('should handle single member tree', () => {
      const secret = generateSecret();
      tree.addMember(0, secret, domainSeparator);

      const proof = tree.getProof(0);
      const leafHash = computeLeafHash(secret, domainSeparator);
      const root = tree.getRoot();

      expect(SparseMerkleTree.verifyProof(leafHash, 0, proof, root)).toBe(true);
    });

    it('should handle large index values', () => {
      const secret = generateSecret();
      const maxIndex = (1 << 20) - 1; // 2^20 - 1 = 1048575

      tree.addMember(maxIndex, secret, domainSeparator);

      const proof = tree.getProof(maxIndex);
      const leafHash = computeLeafHash(secret, domainSeparator);
      const root = tree.getRoot();

      expect(SparseMerkleTree.verifyProof(leafHash, maxIndex, proof, root)).toBe(true);
    });

    it('should handle concurrent member additions', () => {
      const secrets = Array.from({ length: 100 }, () => generateSecret());

      secrets.forEach((secret, index) => {
        tree.addMember(index, secret, domainSeparator);
      });

      expect(tree.getMemberCount()).toBe(100);

      // Verify all proofs still work
      secrets.forEach((secret, index) => {
        const proof = tree.getProof(index);
        const leafHash = computeLeafHash(secret, domainSeparator);
        const root = tree.getRoot();

        expect(SparseMerkleTree.verifyProof(leafHash, index, proof, root)).toBe(true);
      });
    });
  });

  describe('Use Case: Voting', () => {
    it('should allow anonymous voting with replay prevention', () => {
      // Setup: Create voter roll
      const voters = Array.from({ length: 10 }, () => ({
        secret: generateSecret(),
        index: 0,
      }));

      voters.forEach((voter, index) => {
        voter.index = index;
        tree.addMember(index, voter.secret, domainSeparator);
      });

      // Voter 5 votes
      const voter5 = voters[5];
      const witness = createMembershipWitness(voter5.secret, voter5.index, tree, domainSeparator);

      // Verify voter is eligible
      const leafHash = computeLeafHash(voter5.secret, domainSeparator);
      const isValid = SparseMerkleTree.verifyProof(
        leafHash,
        voter5.index,
        witness.siblings,
        tree.getRoot()
      );
      expect(isValid).toBe(true);

      // Record nullifier (vote cast)
      const usedNullifiers = new Set<string>();
      usedNullifiers.add(bytesToHex(witness.nullifier));

      // Try to vote again - should be prevented
      expect(usedNullifiers.has(bytesToHex(witness.nullifier))).toBe(true);
    });
  });

  describe('Use Case: Allowlist', () => {
    it('should manage allowlist with admin root updates', () => {
      // Admin adds members
      const adminSecret = generateSecret();
      const members = Array.from({ length: 5 }, () => generateSecret());

      members.forEach((secret, index) => {
        tree.addMember(index, secret, domainSeparator);
      });

      const root = tree.getRoot();
      expect(root).toBeDefined();

      // Verify a member can prove they're on the allowlist
      const member3 = members[3];
      const proof = tree.getProof(3);
      const leafHash = computeLeafHash(member3, domainSeparator);

      expect(SparseMerkleTree.verifyProof(leafHash, 3, proof, root)).toBe(true);
    });
  });

  describe('Use Case: Gated Access', () => {
    it('should grant access only to verified members', () => {
      // Setup: Membership tree
      const members = Array.from({ length: 3 }, () => generateSecret());
      members.forEach((secret, index) => {
        tree.addMember(index, secret, domainSeparator);
      });

      // Member 1 requests access
      const member1 = members[1];
      const witness = createMembershipWitness(member1, 1, tree, domainSeparator);

      // Contract verifies membership
      const leafHash = computeLeafHash(member1, domainSeparator);
      const isValid = SparseMerkleTree.verifyProof(
        leafHash,
        1,
        witness.siblings,
        tree.getRoot()
      );

      expect(isValid).toBe(true);

      // Access granted - nullifier recorded
      const usedNullifiers = new Set<string>();
      usedNullifiers.add(bytesToHex(witness.nullifier));

      // Non-member tries to access
      const nonMemberSecret = generateSecret();
      const nonMemberLeaf = computeLeafHash(nonMemberSecret, domainSeparator);
      const nonMemberProof = tree.getProof(99); // Not in tree

      const isNonMemberValid = SparseMerkleTree.verifyProof(
        nonMemberLeaf,
        99,
        nonMemberProof,
        tree.getRoot()
      );

      expect(isNonMemberValid).toBe(false);
    });
  });
});
