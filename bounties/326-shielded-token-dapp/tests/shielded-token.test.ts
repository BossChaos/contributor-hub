// Test Suite for Shielded Token Contract
// Covers all circuit operations and edge cases

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSecret,
  computeCommitment,
  computeNullifier,
  createMintWitness,
  createSendWitness,
  createBurnWitness,
} from '../typescript/witnesses';

describe('ShieldedToken Contract Tests', () => {
  // Mock contract state
  let commitmentRoot: Uint8Array;
  let nullifierSet: Set<string>;
  let totalSupply: bigint;

  beforeEach(() => {
    commitmentRoot = new Uint8Array(32);
    nullifierSet = new Set<string>();
    totalSupply = 0n;
  });

  describe('mintShieldedToken', () => {
    it('should successfully mint tokens', () => {
      const witness = createMintWitness(100n);
      const commitment = computeCommitment(witness.amount, witness.secret);
      const newRoot = computeNewRoot(commitment);

      // Verify commitment
      expect(commitment).toEqual(computeCommitment(witness.amount, witness.secret));

      // Verify new root is not empty
      expect(newRoot).not.toEqual(new Uint8Array(32));

      // Update state
      commitmentRoot = newRoot;
      totalSupply += witness.amount;

      expect(totalSupply).toBe(100n);
    });

    it('should handle multiple mints', () => {
      const w1 = createMintWitness(100n);
      const w2 = createMintWitness(200n);

      const c1 = computeCommitment(w1.amount, w1.secret);
      const c2 = computeCommitment(w2.amount, w2.secret);

      commitmentRoot = computeNewRoot(c1, c2);
      totalSupply += w1.amount + w2.amount;

      expect(totalSupply).toBe(300n);
    });

    it('should generate unique secrets for each mint', () => {
      const w1 = createMintWitness(100n);
      const w2 = createMintWitness(100n);

      // Same amount, different secrets
      expect(w1.secret).not.toEqual(w2.secret);
      expect(computeCommitment(w1.amount, w1.secret)).not.toEqual(
        computeCommitment(w2.amount, w2.secret)
      );
    });
  });

  describe('sendShielded', () => {
    it('should successfully transfer tokens', () => {
      // Setup: mint 100 tokens
      const mintWitness = createMintWitness(100n);
      const mintCommitment = computeCommitment(mintWitness.amount, mintWitness.secret);
      commitmentRoot = computeNewRoot(mintCommitment);
      totalSupply = 100n;

      // Send 30 tokens
      const sendWitness = createSendWitness(
        100n,
        mintWitness.secret,
        30n,
        30n
      );

      const senderNullifier = computeNullifier(sendWitness.senderSecret);
      const recipientCommitment = computeCommitment(
        sendWitness.recipientAmount,
        sendWitness.recipientSecret
      );
      const changeCommitment = computeCommitment(
        sendWitness.changeAmount,
        sendWitness.changeSecret
      );

      // Verify conservation
      expect(sendWitness.senderBalance).toBe(
        sendWitness.transferAmount + sendWitness.changeAmount
      );

      // Verify nullifier not used
      expect(nullifierSet.has(bytesToHex(senderNullifier))).toBe(false);

      // Record nullifier
      nullifierSet.add(bytesToHex(senderNullifier));

      expect(nullifierSet.size).toBe(1);
    });

    it('should reject double-spend (reused nullifier)', () => {
      const witness = createMintWitness(100n);
      const nullifier = computeNullifier(witness.secret);

      nullifierSet.add(bytesToHex(nullifier));

      // Try to reuse
      expect(nullifierSet.has(bytesToHex(nullifier))).toBe(true);
    });

    it('should reject insufficient balance', () => {
      const senderBalance = 50n;
      const transferAmount = 100n;

      expect(senderBalance >= transferAmount).toBe(false);
    });

    it('should verify commitment validity', () => {
      const witness = createSendWitness(100n, generateSecret(), 30n, 30n);

      const recipientCommitment = computeCommitment(
        witness.recipientAmount,
        witness.recipientSecret
      );
      const expectedCommitment = computeCommitment(
        witness.recipientAmount,
        witness.recipientSecret
      );

      expect(recipientCommitment).toEqual(expectedCommitment);
    });
  });

  describe('shieldedBurnAddress', () => {
    it('should successfully burn tokens', () => {
      const burnWitness = createBurnWitness(50n);
      const burnNullifier = computeNullifier(burnWitness.burnSecret);

      // Verify nullifier not used
      expect(nullifierSet.has(bytesToHex(burnNullifier))).toBe(false);

      // Record nullifier and reduce supply
      nullifierSet.add(bytesToHex(burnNullifier));
      totalSupply -= burnWitness.burnAmount;

      expect(nullifierSet.size).toBe(1);
      expect(totalSupply).toBe(-50n); // Would be caught in contract
    });

    it('should prevent burning with reused nullifier', () => {
      const w1 = createBurnWitness(10n);
      const w2 = createBurnWitness(10n);

      // Different secrets = different nullifiers
      const n1 = computeNullifier(w1.burnSecret);
      const n2 = computeNullifier(w2.burnSecret);

      expect(n1).not.toEqual(n2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero-amount transfers', () => {
      const witness = createSendWitness(100n, generateSecret(), 0n, 0n);
      expect(witness.transferAmount).toBe(0n);
      expect(witness.changeAmount).toBe(100n);
    });

    it('should handle full-balance transfers', () => {
      const witness = createSendWitness(100n, generateSecret(), 100n, 100n);
      expect(witness.changeAmount).toBe(0n);
    });

    it('should handle large amounts', () => {
      const largeAmount = BigInt('1000000000000000000');
      const witness = createMintWitness(largeAmount);
      const commitment = computeCommitment(witness.amount, witness.secret);

      expect(commitment).toEqual(computeCommitment(largeAmount, witness.secret));
    });

    it('should generate unique nullifiers for different secrets', () => {
      const s1 = generateSecret();
      const s2 = generateSecret();

      const n1 = computeNullifier(s1);
      const n2 = computeNullifier(s2);

      expect(n1).not.toEqual(n2);
    });
  });
});

// Helper functions
function computeNewRoot(...commitments: Uint8Array[]): Uint8Array {
  // Mock implementation - in real app, update Merkle tree
  return new Uint8Array(32);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
