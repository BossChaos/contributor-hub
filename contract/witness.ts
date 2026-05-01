// TypeScript Witness for Private NFT Marketplace
// Handles witness generation for blind bids and purchases

import { createHash } from 'crypto';

/**
 * Generate a price commitment for private listing
 * @param price - The actual price to commit to
 * @returns Promise<Uint8Array> - The commitment hash
 */
export async function generatePriceCommitment(price: bigint): Promise<Uint8Array> {
  // Convert price to bytes (little-endian)
  const priceBytes = bigintToBytes(price, 32);

  // Hash the price bytes using SHA-256
  const hash = createHash('sha256');
  hash.update(Buffer.from(priceBytes));
  return new Uint8Array(hash.digest());
}

/**
 * Generate a bid commitment for blind auction
 * @param bidAmount - The bid amount
 * @param bidderAddress - The bidder's address
 * @param nonce - Random nonce for commitment
 * @returns Promise<Uint8Array> - The bid commitment hash
 */
export async function generateBidCommitment(
  bidAmount: bigint,
  bidderAddress: string,
  nonce: bigint
): Promise<Uint8Array> {
  // Concatenate bid amount, address, and nonce
  const amountBytes = bigintToBytes(bidAmount, 32);
  const addressBytes = hexStringToBytes(bidderAddress);
  const nonceBytes = bigintToBytes(nonce, 32);

  // Combine all components
  const combined = new Uint8Array(32 + 20 + 32);
  combined.set(amountBytes, 0);
  combined.set(addressBytes, 32);
  combined.set(nonceBytes, 52);

  // Hash using SHA-256
  const hash = createHash('sha256');
  hash.update(Buffer.from(combined));
  return new Uint8Array(hash.digest());
}

/**
 * Witness for purchase - reveals the actual price
 * @param price - The actual price
 * @returns Promise<Uint8Array> - Witness data (price in bytes)
 */
export async function purchaseWitness(price: bigint): Promise<Uint8Array> {
  return bigintToBytes(price, 32);
}

/**
 * Witness for bid reveal - proves commitment matches bid
 * @param bidAmount - The bid amount
 * @param bidderAddress - The bidder's address
 * @param nonce - The nonce used in commitment
 * @returns Promise<Uint8Array> - Witness data
 */
export async function bidRevealWitness(
  bidAmount: bigint,
  bidderAddress: string,
  nonce: bigint
): Promise<Uint8Array> {
  const amountBytes = bigintToBytes(bidAmount, 32);
  const addressBytes = hexStringToBytes(bidderAddress);
  const nonceBytes = bigintToBytes(nonce, 32);

  const combined = new Uint8Array(32 + 20 + 32);
  combined.set(amountBytes, 0);
  combined.set(addressBytes, 32);
  combined.set(nonceBytes, 52);

  return combined;
}

/**
 * Convert bigint to bytes (little-endian)
 */
function bigintToBytes(value: bigint, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let temp = value;
  const mask = BigInt(0xff);
  const shift = BigInt(8);
  for (let i = 0; i < size; i++) {
    bytes[i] = Number(temp & mask);
    temp = temp >> shift;
  }
  return bytes;
}

/**
 * Convert hex string to bytes
 */
function hexStringToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}

// All functions are exported inline above
