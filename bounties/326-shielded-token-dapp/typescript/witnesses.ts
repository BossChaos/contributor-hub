// TypeScript Witnesses for Shielded Token Contract
// Implements witness generation for all circuit operations
// Uses Node.js crypto module for hashing

import { randomBytes, createHash } from 'crypto';

/**
 * Generate a random 32-byte secret
 * Uses cryptographically secure random number generator
 */
export function generateSecret(): Uint8Array {
  return randomBytes(32);
}

/**
 * Compute commitment from amount and secret
 * H(amount, secret) - binds amount to secret without revealing either
 * Uses SHA-256 hash function
 */
export function computeCommitment(
  amount: bigint,
  secret: Uint8Array
): Uint8Array {
  // Convert amount to 8-byte big-endian buffer
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64BE(amount);
  
  // Compute SHA-256 hash of (amount || secret)
  const hash = createHash('sha256');
  hash.update(amountBuf);
  hash.update(Buffer.from(secret));
  return hash.digest();
}

/**
 * Compute nullifier from secret
 * H(secret, 0) - unique identifier that prevents reuse
 * The domain separator (0) distinguishes nullifiers from commitments
 */
export function computeNullifier(secret: Uint8Array): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(secret));
  hash.update(Buffer.from([0])); // Domain separator
  return hash.digest();
}

/**
 * Witness for mintShieldedToken circuit
 */
export interface MintShieldedTokenWitness {
  amount: bigint;
  secret: Uint8Array;
}

export function createMintWitness(
  amount: bigint
): MintShieldedTokenWitness {
  const secret = generateSecret();
  return { amount, secret };
}

/**
 * Witness for evolveNonce circuit
 */
export interface EvolveNonceWitness {
  oldAmount: bigint;
  oldSecret: Uint8Array;
  newSecret: Uint8Array;
}

export function createEvolveWitness(
  oldAmount: bigint,
  oldSecret: Uint8Array
): EvolveNonceWitness {
  const newSecret = generateSecret();
  return { oldAmount, oldSecret, newSecret };
}

/**
 * Witness for sendShielded circuit
 */
export interface SendShieldedWitness {
  senderBalance: bigint;
  senderSecret: Uint8Array;
  recipientAmount: bigint;
  recipientSecret: Uint8Array;
  changeAmount: bigint;
  changeSecret: Uint8Array;
}

export function createSendWitness(
  senderBalance: bigint,
  senderSecret: Uint8Array,
  transferAmount: bigint,
  recipientAmount: bigint
): SendShieldedWitness {
  const changeAmount = senderBalance - transferAmount;
  const recipientSecret = generateSecret();
  const changeSecret = generateSecret();
  
  return {
    senderBalance,
    senderSecret,
    recipientAmount,
    recipientSecret,
    changeAmount,
    changeSecret,
  };
}

/**
 * Witness for sendImmediateShielded circuit
 */
export interface SendImmediateShieldedWitness {
  senderBalance: bigint;
  senderSecret: Uint8Array;
  recipientAmount: bigint;
  recipientSecret: Uint8Array;
}

export function createImmediateSendWitness(
  senderBalance: bigint,
  senderSecret: Uint8Array,
  transferAmount: bigint
): SendImmediateShieldedWitness {
  const recipientSecret = generateSecret();
  
  return {
    senderBalance,
    senderSecret,
    recipientAmount: transferAmount,
    recipientSecret,
  };
}

/**
 * Witness for shieldedBurnAddress circuit
 */
export interface ShieldedBurnWitness {
  burnAmount: bigint;
  burnSecret: Uint8Array;
}

export function createBurnWitness(
  burnAmount: bigint
): ShieldedBurnWitness {
  const burnSecret = generateSecret();
  return { burnAmount, burnSecret };
}

/**
 * Utility: Convert bytes to hex string for logging/debugging
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
