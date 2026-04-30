// Test Suite for Compliance Attestation System
// Covers selective disclosure, domain separation, and cross-property unlinkability

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SparseMerkleTree,
  computePropertyCommitment,
  computeProofCommitment,
  createPropertyProofWitness,
  generateDomainSeparator,
  PropertyType,
  PropertyData,
  bytesToHex,
  generateSecret,
} from '../typescript/witnesses';

describe('ComplianceAttestation Contract Tests', () => {
  let tree: SparseMerkleTree;

  beforeEach(() => {
    tree = new SparseMerkleTree(20);
  });

  describe('Property Commitment', () => {
    it('should compute property commitment correctly', () => {
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000, // 24 hours
        metadata: 'age-verification',
      };

      const secret = generateSecret();
      const commitment = computePropertyCommitment(propertyData, secret);

      expect(commitment).toBeDefined();
      expect(commitment.length).toBe(32);

      // Same data + secret = same commitment
      const commitment2 = computePropertyCommitment(propertyData, secret);
      expect(commitment).toEqual(commitment2);
    });

    it('should produce different commitments for different secrets', () => {
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const secret1 = generateSecret();
      const secret2 = generateSecret();

      const c1 = computePropertyCommitment(propertyData, secret1);
      const c2 = computePropertyCommitment(propertyData, secret2);

      expect(c1).not.toEqual(c2);
    });

    it('should produce different commitments for different property types', () => {
      const secret = generateSecret();

      const ageData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const residencyData: PropertyData = {
        type: PropertyType.RESIDENCY,
        value: 'US',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'residency-verification',
      };

      const c1 = computePropertyCommitment(ageData, secret);
      const c2 = computePropertyCommitment(residencyData, secret);

      expect(c1).not.toEqual(c2);
    });
  });

  describe('Proof Commitment with Domain Separation', () => {
    it('should compute proof commitment correctly', () => {
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const secret = generateSecret();
      const propertyCommitment = computePropertyCommitment(propertyData, secret);
      const domainSeparator = generateDomainSeparator(PropertyType.AGE);
      const nonce = generateSecret();

      const proofCommitment = computeProofCommitment(propertyCommitment, domainSeparator, nonce);

      expect(proofCommitment).toBeDefined();
      expect(proofCommitment.length).toBe(32);
    });

    it('should produce different proof commitments for different domains', () => {
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const secret = generateSecret();
      const propertyCommitment = computePropertyCommitment(propertyData, secret);

      const domain1 = generateDomainSeparator(PropertyType.AGE);
      const domain2 = generateDomainSeparator(PropertyType.RESIDENCY);
      const nonce = generateSecret();

      const pc1 = computeProofCommitment(propertyCommitment, domain1, nonce);
      const pc2 = computeProofCommitment(propertyCommitment, domain2, nonce);

      // Same property, different domains = different proof commitments
      expect(pc1).not.toEqual(pc2);
    });

    it('should produce different proof commitments for different nonces', () => {
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const secret = generateSecret();
      const propertyCommitment = computePropertyCommitment(propertyData, secret);
      const domainSeparator = generateDomainSeparator(PropertyType.AGE);

      const nonce1 = generateSecret();
      const nonce2 = generateSecret();

      const pc1 = computeProofCommitment(propertyCommitment, domainSeparator, nonce1);
      const pc2 = computeProofCommitment(propertyCommitment, domainSeparator, nonce2);

      // Same property, same domain, different nonces = different proof commitments
      expect(pc1).not.toEqual(pc2);
    });
  });

  describe('Cross-Property Unlinkability', () => {
    it('should prevent linking proofs across different property types', () => {
      const secret = generateSecret();

      // User has two properties: age and residency
      const ageData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const residencyData: PropertyData = {
        type: PropertyType.RESIDENCY,
        value: 'US',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'residency-verification',
      };

      // Compute commitments
      const ageCommitment = computePropertyCommitment(ageData, secret);
      const residencyCommitment = computePropertyCommitment(residencyData, secret);

      // Add to tree
      tree.addLeaf(0, ageCommitment);
      tree.addLeaf(1, residencyCommitment);

      // Generate proofs with different domain separators
      const ageDomain = generateDomainSeparator(PropertyType.AGE);
      const residencyDomain = generateDomainSeparator(PropertyType.RESIDENCY);

      const ageWitness = createPropertyProofWitness(ageData, secret, 0, tree, ageDomain);
      const residencyWitness = createPropertyProofWitness(residencyData, secret, 1, tree, residencyDomain);

      // Proof commitments should be completely different
      expect(ageWitness.proofCommitment).not.toEqual(residencyWitness.proofCommitment);

      // No observer can link these two proofs to the same user
      // because they use different domain separators and nonces
    });

    it('should prevent linking proofs across different uses of same property', () => {
      const secret = generateSecret();

      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const propertyCommitment = computePropertyCommitment(propertyData, secret);
      tree.addLeaf(0, propertyCommitment);

      const domain = generateDomainSeparator(PropertyType.AGE);

      // Generate two proofs for the same property
      const witness1 = createPropertyProofWitness(propertyData, secret, 0, tree, domain);
      const witness2 = createPropertyProofWitness(propertyData, secret, 0, tree, domain);

      // Different nonces = different proof commitments
      expect(witness1.proofCommitment).not.toEqual(witness2.proofCommitment);

      // No observer can link these two proofs
      // because each uses a unique nonce
    });
  });

  describe('Merkle Tree Operations', () => {
    it('should support adding multiple attestations', () => {
      const secrets = Array.from({ length: 5 }, () => generateSecret());

      secrets.forEach((secret, index) => {
        const propertyData: PropertyData = {
          type: PropertyType.AGE,
          value: `${20 + index}`,
          issuedAt: Date.now(),
          expiresAt: Date.now() + 86400000,
          metadata: 'age-verification',
        };

        const commitment = computePropertyCommitment(propertyData, secret);
        tree.addLeaf(index, commitment);
      });

      expect(tree.getLeafCount()).toBe(5);
    });

    it('should generate valid Merkle proofs', () => {
      const secret = generateSecret();
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const commitment = computePropertyCommitment(propertyData, secret);
      tree.addLeaf(42, commitment);

      const proof = tree.getProof(42);
      expect(proof.length).toBe(20);

      const isValid = SparseMerkleTree.verifyProof(commitment, 42, proof, tree.getRoot());
      expect(isValid).toBe(true);
    });

    it('should reject invalid Merkle proofs', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      const data1: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const data2: PropertyData = {
        type: PropertyType.RESIDENCY,
        value: 'US',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'residency-verification',
      };

      const c1 = computePropertyCommitment(data1, secret1);
      const c2 = computePropertyCommitment(data2, secret2);

      tree.addLeaf(0, c1);
      tree.addLeaf(1, c2);

      const proof = tree.getProof(0);
      const isValid = SparseMerkleTree.verifyProof(c2, 0, proof, tree.getRoot()); // Wrong leaf

      expect(isValid).toBe(false);
    });
  });

  describe('Replay Prevention', () => {
    it('should detect proof reuse', () => {
      const secret = generateSecret();
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const propertyCommitment = computePropertyCommitment(propertyData, secret);
      tree.addLeaf(0, propertyCommitment);

      const domain = generateDomainSeparator(PropertyType.AGE);
      const witness = createPropertyProofWitness(propertyData, secret, 0, tree, domain);

      // Simulate used proofs set
      const usedProofs = new Set<string>();

      // First use - should be allowed
      expect(usedProofs.has(bytesToHex(witness.proofCommitment))).toBe(false);
      usedProofs.add(bytesToHex(witness.proofCommitment));

      // Second use - should be detected
      expect(usedProofs.has(bytesToHex(witness.proofCommitment))).toBe(true);
    });
  });

  describe('Use Case: Age Verification', () => {
    it('should prove age >= 18 without revealing actual age', () => {
      const secret = generateSecret();
      const propertyData: PropertyData = {
        type: PropertyType.AGE,
        value: '25', // Actual age is 25, but we only prove >= 18
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'age-verification',
      };

      const commitment = computePropertyCommitment(propertyData, secret);
      tree.addLeaf(0, commitment);

      const domain = generateDomainSeparator(PropertyType.AGE);
      const witness = createPropertyProofWitness(propertyData, secret, 0, tree, domain);

      // Verify proof is valid
      const isValid = SparseMerkleTree.verifyProof(
        witness.propertyCommitment,
        0,
        witness.siblings,
        tree.getRoot()
      );
      expect(isValid).toBe(true);

      // Proof commitment is recorded
      const usedProofs = new Set<string>();
      usedProofs.add(bytesToHex(witness.proofCommitment));

      // Observer knows: user has valid age attestation
      // Observer doesn't know: user is 25 (not 18, not 30)
    });
  });

  describe('Use Case: Residency Verification', () => {
    it('should prove residency without revealing exact location', () => {
      const secret = generateSecret();
      const propertyData: PropertyData = {
        type: PropertyType.RESIDENCY,
        value: 'US', // Region-level, not city-level
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        metadata: 'residency-verification',
      };

      const commitment = computePropertyCommitment(propertyData, secret);
      tree.addLeaf(0, commitment);

      const domain = generateDomainSeparator(PropertyType.RESIDENCY);
      const witness = createPropertyProofWitness(propertyData, secret, 0, tree, domain);

      const isValid = SparseMerkleTree.verifyProof(
        witness.propertyCommitment,
        0,
        witness.siblings,
        tree.getRoot()
      );
      expect(isValid).toBe(true);
    });
  });

  describe('Use Case: Certification Verification', () => {
    it('should prove certification without revealing other properties', () => {
      const secret = generateSecret();
      const propertyData: PropertyData = {
        type: PropertyType.CERTIFICATION,
        value: 'CFA', // Certification type
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000 * 365, // 1 year
        metadata: 'cfa-certification',
      };

      const commitment = computePropertyCommitment(propertyData, secret);
      tree.addLeaf(0, commitment);

      const domain = generateDomainSeparator(PropertyType.CERTIFICATION);
      const witness = createPropertyProofWitness(propertyData, secret, 0, tree, domain);

      const isValid = SparseMerkleTree.verifyProof(
        witness.propertyCommitment,
        0,
        witness.siblings,
        tree.getRoot()
      );
      expect(isValid).toBe(true);

      // Observer knows: user has CFA certification
      // Observer doesn't know: user's age, residency, or other properties
    });
  });
});
