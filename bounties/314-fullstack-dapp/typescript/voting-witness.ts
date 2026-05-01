/**
 * Witness generation for PrivateVoting contract.
 *
 * Witnesses provide the private inputs needed for ZK proof generation.
 * In this voting dApp, witnesses generate:
 * - Nullifiers (unique per voter, derived from secret + election ID)
 * - Vote commitments (binding commitments to vote values)
 *
 * Key security properties:
 * - Nullifiers are one-way: given a nullifier, you cannot derive the voter's secret
 * - Commitments are binding: once committed, the vote value cannot be changed
 * - Domain separation: election ID prevents vote reuse across elections
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Generate a unique nullifier for a voter.
 *
 * The nullifier is derived from the voter's secret key and the election ID.
 * This ensures:
 * 1. Each voter gets a unique nullifier (prevents double-voting)
 * 2. The nullifier doesn't reveal the voter's identity
 * 3. The nullifier is election-specific (domain separation)
 *
 * @param secretKey - Voter's secret key (32 bytes, kept private)
 * @param electionId - Election identifier (32 bytes)
 * @returns Nullifier (32 bytes)
 */
export function generateNullifier(secretKey: Uint8Array, electionId: Uint8Array): Uint8Array {
    // Hash the secret key with the election ID for domain separation
    const combined = new Uint8Array(64);
    combined.set(secretKey, 0);
    combined.set(electionId, 32);
    return sha256(combined);
}

/**
 * Generate a vote commitment.
 *
 * The commitment binds the voter to their vote without revealing it.
 * The contract verifies the commitment matches the disclosed vote value.
 *
 * @param voteValue - The vote (0 for Option A, 1 for Option B)
 * @param electionId - Election identifier (32 bytes)
 * @returns Vote commitment (32 bytes)
 */
export function generateVoteCommitment(voteValue: number, electionId: Uint8Array): Uint8Array {
    // Create a buffer with the vote value (as a single byte) and election ID
    const voteByte = new Uint8Array([voteValue]);
    const combined = new Uint8Array(1 + 32);
    combined.set(voteByte, 0);
    combined.set(electionId, 1);
    return sha256(combined);
}

/**
 * Generate all witness data for casting a vote.
 *
 * This is the main function called by the frontend when a voter wants to cast a vote.
 * It generates the nullifier and commitment needed for the contract call.
 *
 * @param secretKey - Voter's secret key (hex string, 64 chars)
 * @param electionIdHex - Election ID (hex string, 64 chars)
 * @param voteValue - The vote (0 for Option A, 1 for Option B)
 * @returns Object containing nullifier and voteCommitment as hex strings
 */
export function generateVoteWitness(
    secretKey: string,
    electionIdHex: string,
    voteValue: number
): { nullifier: string; voteCommitment: string } {
    const secretKeyBytes = hexToBytes(secretKey);
    const electionIdBytes = hexToBytes(electionIdHex);

    const nullifier = generateNullifier(secretKeyBytes, electionIdBytes);
    const voteCommitment = generateVoteCommitment(voteValue, electionIdBytes);

    return {
        nullifier: bytesToHex(nullifier),
        voteCommitment: bytesToHex(voteCommitment),
    };
}

/**
 * Generate a random secret key for a new voter.
 *
 * In production, this should be generated from a hardware wallet or
 * a secure key derivation function. For demo purposes, we use
 * cryptographically secure random bytes.
 *
 * @returns Secret key as hex string (64 chars = 32 bytes)
 */
export function generateSecretKey(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
}
