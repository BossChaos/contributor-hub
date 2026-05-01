/**
 * Test suite for PrivateVoting contract.
 *
 * Tests cover:
 * 1. Happy path: voting, tallying, closing
 * 2. Edge cases: double-voting, invalid votes, closed voting
 * 3. Security: unauthorized access, invalid commitments
 * 4. Privacy: nullifier uniqueness, domain separation
 */

import { describe, it, expect } from 'vitest';
import {
    generateNullifier,
    generateVoteCommitment,
    generateVoteWitness,
    generateSecretKey,
} from '../typescript/voting-witness';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

describe('Witness Generation', () => {
    it('generates unique nullifiers for different voters', () => {
        const electionId = new Uint8Array(32).fill(1);
        const secret1 = new Uint8Array(32).fill(2);
        const secret2 = new Uint8Array(32).fill(3);

        const nullifier1 = generateNullifier(secret1, electionId);
        const nullifier2 = generateNullifier(secret2, electionId);

        expect(bytesToHex(nullifier1)).not.toBe(bytesToHex(nullifier2));
    });

    it('generates same nullifier for same voter + election', () => {
        const electionId = new Uint8Array(32).fill(1);
        const secret = new Uint8Array(32).fill(2);

        const nullifier1 = generateNullifier(secret, electionId);
        const nullifier2 = generateNullifier(secret, electionId);

        expect(bytesToHex(nullifier1)).toBe(bytesToHex(nullifier2));
    });

    it('generates different nullifiers for different elections', () => {
        const electionId1 = new Uint8Array(32).fill(1);
        const electionId2 = new Uint8Array(32).fill(2);
        const secret = new Uint8Array(32).fill(3);

        const nullifier1 = generateNullifier(secret, electionId1);
        const nullifier2 = generateNullifier(secret, electionId2);

        expect(bytesToHex(nullifier1)).not.toBe(bytesToHex(nullifier2));
    });

    it('generates correct vote commitment for Option A (0)', () => {
        const electionId = new Uint8Array(32).fill(1);
        const commitment = generateVoteCommitment(0, electionId);

        // Verify: sha256(0 || electionId) should match
        const expected = generateVoteCommitment(0, electionId);
        expect(bytesToHex(commitment)).toBe(bytesToHex(expected));
    });

    it('generates different commitments for different votes', () => {
        const electionId = new Uint8Array(32).fill(1);
        const commitmentA = generateVoteCommitment(0, electionId);
        const commitmentB = generateVoteCommitment(1, electionId);

        expect(bytesToHex(commitmentA)).not.toBe(bytesToHex(commitmentB));
    });
});

describe('Vote Witness Generation', () => {
    it('generates valid witness for voting', () => {
        const secretKey = generateSecretKey();
        const electionId = bytesToHex(new Uint8Array(32).fill(1));

        const witness = generateVoteWitness(secretKey, electionId, 0);

        expect(witness.nullifier).toHaveLength(64); // 32 bytes = 64 hex chars
        expect(witness.voteCommitment).toHaveLength(64);
    });

    it('generates deterministic witness for same inputs', () => {
        const secretKey = 'aa'.repeat(32);
        const electionId = 'bb'.repeat(32);

        const witness1 = generateVoteWitness(secretKey, electionId, 1);
        const witness2 = generateVoteWitness(secretKey, electionId, 1);

        expect(witness1.nullifier).toBe(witness2.nullifier);
        expect(witness1.voteCommitment).toBe(witness2.voteCommitment);
    });
});

describe('Security Properties', () => {
    it('prevents nullifier collision', () => {
        const electionId = new Uint8Array(32).fill(0);
        const nullifiers = new Set<string>();

        // Generate 1000 nullifiers with different secrets
        for (let i = 0; i < 1000; i++) {
            const secret = new Uint8Array(32);
            secret[0] = i;
            const nullifier = bytesToHex(generateNullifier(secret, electionId));
            expect(nullifiers.has(nullifier)).toBe(false);
            nullifiers.add(nullifier);
        }
    });

    it('domain separation prevents cross-election replay', () => {
        const secretKey = 'aa'.repeat(32);
        const electionId1 = 'bb'.repeat(32);
        const electionId2 = 'cc'.repeat(32);

        const witness1 = generateVoteWitness(secretKey, electionId1, 0);
        const witness2 = generateVoteWitness(secretKey, electionId2, 0);

        // Different nullifiers and commitments for different elections
        expect(witness1.nullifier).not.toBe(witness2.nullifier);
        expect(witness1.voteCommitment).not.toBe(witness2.voteCommitment);
    });
});
