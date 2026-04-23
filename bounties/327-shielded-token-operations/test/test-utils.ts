// Test utilities for ShieldedToken contract tests
// Provides mock implementations for Midnight network testing

import { ShieldedCoinInfo, QualifiedShieldedCoinInfo, ZswapCoinPublicKey } from "@midnight-labs/compact";

/**
 * Creates a mock test context for contract deployment
 */
export async function createTestContext() {
    return {
        network: "testnet",
        rpcUrl: "http://localhost:9944",
        blockNumber: 1,
    };
}

/**
 * Generates a mock key pair for testing
 */
export async function generateTestKeyPair() {
    // In a real test environment, this would use the Midnight SDK
    // For now, we provide a mock implementation
    const publicKey: ZswapCoinPublicKey = {
        bytes: new Uint8Array(32).fill(0).map((_, i) => i + 1),
    };
    
    return {
        publicKey,
        secretKey: new Uint8Array(32).fill(0),
    };
}

/**
 * Creates a qualified coin from a shielded coin info
 */
export async function createTestCoin(coinInfo: ShieldedCoinInfo): Promise<QualifiedShieldedCoinInfo> {
    return {
        nonce: coinInfo.nonce,
        color: coinInfo.color,
        value: coinInfo.value,
        mtIndex: 0n, // Mock Merkle tree index
    };
}

/**
 * Mock ShieldedSendResult for testing
 */
export function createMockSendResult(sent: ShieldedCoinInfo, change?: ShieldedCoinInfo) {
    return {
        sent,
        change: change ? { isSome: true, value: change } : { isSome: false },
    };
}
