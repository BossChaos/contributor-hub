// SPDX-License-Identifier: Apache-2.0
// Test Suite for ShieldedToken Contract
// Bounty #327 - Midnight Contributor Hub

import { ShieldedToken } from "./managed/shielded-token/contract";
import { 
    createTestContext, 
    generateTestKeyPair,
    createTestCoin
} from "./test-utils";

/**
 * Comprehensive test suite for ShieldedToken contract.
 * Covers all Bounty #327 requirements:
 * - mintShieldedToken
 * - evolveNonce
 * - sendShielded
 * - ShieldedSendResult
 * - sendImmediateShielded
 * - shieldedBurnAddress()
 * - mint_and_send
 */

describe("ShieldedToken Contract Tests", () => {
    let contract: ShieldedToken;
    let minter: any;
    let recipient1: any;
    let recipient2: any;
    let testContext: any;

    beforeEach(async () => {
        // Set up test environment
        testContext = await createTestContext();
        minter = await generateTestKeyPair();
        recipient1 = await generateTestKeyPair();
        recipient2 = await generateTestKeyPair();
        
        // Deploy contract
        contract = await ShieldedToken.deploy(testContext);
        
        // Initialize with minter
        await contract.initialize(minter.publicKey);
    });

    // ============================================================
    // TEST: Mint Shielded Token
    // ============================================================

    describe("mintShieldedToken", () => {
        it("should mint a new shielded token with correct amount", async () => {
            const mintAmount = 1000n;
            
            const result = await contract.mintShieldedToken(
                recipient1.publicKey,
                mintAmount
            );

            // Verify the minted coin
            expect(result.value).toBe(mintAmount);
            expect(result.nonce).toBeDefined();
            expect(result.color).toBeDefined();
        });

        it("should increment total supply after minting", async () => {
            const initialSupply = await contract.getTotalSupply();
            expect(initialSupply).toBe(0n);

            await contract.mintShieldedToken(recipient1.publicKey, 500n);
            
            const newSupply = await contract.getTotalSupply();
            expect(newSupply).toBe(500n);
        });

        it("should evolve nonce on each mint", async () => {
            const result1 = await contract.mintShieldedToken(recipient1.publicKey, 100n);
            const result2 = await contract.mintShieldedToken(recipient2.publicKey, 200n);

            // Nonces must be different
            expect(result1.nonce).not.toBe(result2.nonce);
            
            // Verify nonce counter incremented
            const counter = await contract.getNonceCounter();
            expect(counter).toBe(2n);
        });

        it("should reject minting before initialization", async () => {
            const uninitializedContract = await ShieldedToken.deploy(testContext);
            
            await expect(
                uninitializedContract.mintShieldedToken(recipient1.publicKey, 100n)
            ).rejects.toThrow("Not initialized");
        });
    });

    // ============================================================
    // TEST: Send Shielded
    // ============================================================

    describe("sendShielded", () => {
        it("should transfer tokens and return ShieldedSendResult", async () => {
            // First mint a coin
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                1000n
            );

            // Create a qualified coin from the minted one
            const qualifiedCoin = await createTestCoin(mintResult);

            // Transfer to recipient2
            const sendResult = await contract.sendShielded(
                qualifiedCoin,
                recipient2.publicKey,
                300n
            );

            // Verify ShieldedSendResult structure
            expect(sendResult.sent).toBeDefined();
            expect(sendResult.sent.value).toBe(300n);
            expect(sendResult.change).toBeDefined();
        });

        it("should handle change correctly", async () => {
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                1000n
            );
            const qualifiedCoin = await createTestCoin(mintResult);

            const sendResult = await contract.sendShielded(
                qualifiedCoin,
                recipient2.publicKey,
                300n
            );

            // Change should be 700 (1000 - 300)
            expect(sendResult.change.isSome).toBe(true);
            if (sendResult.change.isSome) {
                expect(sendResult.change.value.value).toBe(700n);
            }
        });

        it("should fail when sending more than coin value", async () => {
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                100n
            );
            const qualifiedCoin = await createTestCoin(mintResult);

            await expect(
                contract.sendShielded(qualifiedCoin, recipient2.publicKey, 200n)
            ).rejects.toThrow("Insufficient coin balance");
        });
    });

    // ============================================================
    // TEST: Send Immediate Shielded
    // ============================================================

    describe("sendImmediateShielded", () => {
        it("should transfer tokens immediately without ledger storage", async () => {
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                500n
            );

            const sendResult = await contract.sendImmediateShielded(
                mintResult,
                recipient2.publicKey,
                200n
            );

            expect(sendResult.sent.value).toBe(200n);
            expect(sendResult.change.isSome).toBe(true);
        });

        it("should handle exact amount transfer (no change)", async () => {
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                500n
            );

            const sendResult = await contract.sendImmediateShielded(
                mintResult,
                recipient2.publicKey,
                500n
            );

            expect(sendResult.sent.value).toBe(500n);
            expect(sendResult.change.isSome).toBe(false);
        });
    });

    // ============================================================
    // TEST: Shielded Burn
    // ============================================================

    describe("shieldedBurn", () => {
        it("should permanently remove tokens from circulation", async () => {
            // Mint tokens
            await contract.mintShieldedToken(recipient1.publicKey, 1000n);
            expect(await contract.getTotalSupply()).toBe(1000n);

            // Create qualified coin for burning
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                500n
            );
            const qualifiedCoin = await createTestCoin(mintResult);

            // Burn tokens
            const change = await contract.shieldedBurn(qualifiedCoin, 300n);

            // Verify supply reduced
            expect(await contract.getTotalSupply()).toBe(1200n); // 1000 + 500 - 300
            
            // Change should exist
            expect(change.isSome).toBe(true);
        });

        it("should fail when burning more than coin value", async () => {
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                100n
            );
            const qualifiedCoin = await createTestCoin(mintResult);

            await expect(
                contract.shieldedBurn(qualifiedCoin, 200n)
            ).rejects.toThrow("Insufficient coin for burn");
        });
    });

    // ============================================================
    // TEST: Mint and Send
    // ============================================================

    describe("mint_and_send", () => {
        it("should mint and send in a single operation", async () => {
            const result = await contract.mint_and_send(
                recipient1.publicKey,
                1000n,  // mint amount
                500n    // send amount
            );

            expect(result.sent.value).toBe(500n);
            expect(result.change.isSome).toBe(true);
            
            // Total supply should reflect full mint amount
            expect(await contract.getTotalSupply()).toBe(1000n);
        });

        it("should fail when send amount exceeds mint amount", async () => {
            await expect(
                contract.mint_and_send(
                    recipient1.publicKey,
                    100n,
                    200n
                )
            ).rejects.toThrow("Send amount exceeds mint amount");
        });

        it("should work with equal mint and send amounts", async () => {
            const result = await contract.mint_and_send(
                recipient1.publicKey,
                500n,
                500n
            );

            expect(result.sent.value).toBe(500n);
            expect(result.change.isSome).toBe(false);
        });
    });

    // ============================================================
    // TEST: Nonce Evolution
    // ============================================================

    describe("evolveNonce", () => {
        it("should produce unique nonces for each mint", async () => {
            const nonces = new Set<string>();
            
            for (let i = 0; i < 10; i++) {
                const result = await contract.mintShieldedToken(
                    recipient1.publicKey,
                    1n
                );
                nonces.add(result.nonce);
            }

            // All 10 nonces should be unique
            expect(nonces.size).toBe(10);
        });

        it("should increment nonce counter monotonically", async () => {
            let prevCounter = await contract.getNonceCounter();
            expect(prevCounter).toBe(0n);

            for (let i = 1; i <= 5; i++) {
                await contract.mintShieldedToken(recipient1.publicKey, 1n);
                const currentCounter = await contract.getNonceCounter();
                expect(currentCounter).toBe(BigInt(i));
                prevCounter = currentCounter;
            }
        });
    });

    // ============================================================
    // TEST: ShieldedSendResult Structure
    // ============================================================

    describe("ShieldedSendResult", () => {
        it("should have correct structure after send", async () => {
            const mintResult = await contract.mintShieldedToken(
                recipient1.publicKey,
                1000n
            );
            const qualifiedCoin = await createTestCoin(mintResult);

            const result = await contract.sendShielded(
                qualifiedCoin,
                recipient2.publicKey,
                400n
            );

            // Verify structure
            expect(result).toHaveProperty("sent");
            expect(result).toHaveProperty("change");
            expect(result.sent).toHaveProperty("nonce");
            expect(result.sent).toHaveProperty("color");
            expect(result.sent).toHaveProperty("value");
            expect(result.change).toHaveProperty("isSome");
        });
    });
});
