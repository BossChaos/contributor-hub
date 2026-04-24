// Test suite for Unshielded Token dApp
// Tests mint, send, receive, and query operations

import { describe, it, expect } from 'vitest';
import { UnshieldedToken } from '../out/contract/index.js';

describe('UnshieldedToken Contract', () => {
  let contract;
  let ownerWallet;
  let user1Wallet;
  let user2Wallet;

  beforeEach(async () => {
    // Initialize test wallets
    ownerWallet = await createTestWallet();
    user1Wallet = await createTestWallet();
    user2Wallet = await createTestWallet();

    // Deploy contract
    contract = await UnshieldedToken.deploy({
      owner: ownerWallet.address,
      tokenColor: '0x0000000000000000000000000000000000000000000000000000000000000001',
    });
  });

  describe('mintUnshieldedToken', () => {
    it('should mint tokens to recipient', async () => {
      const result = await contract.mintUnshieldedToken(
        user1Wallet.address,
        1000n
      );

      expect(result).toBe(1000n);
      
      const balance = await contract.getBalance(user1Wallet.address);
      expect(balance).toBe(1000n);
    });

    it('should reject minting by non-owner', async () => {
      await expect(
        contract.mintUnshieldedToken(user1Wallet.address, 100n, {
          wallet: user1Wallet,
        })
      ).rejects.toThrow('Only owner can mint');
    });

    it('should reject zero amount', async () => {
      await expect(
        contract.mintUnshieldedToken(user1Wallet.address, 0n)
      ).rejects.toThrow('Amount must be positive');
    });

    it('should update total supply', async () => {
      await contract.mintUnshieldedToken(user1Wallet.address, 500n);
      await contract.mintUnshieldedToken(user2Wallet.address, 300n);

      const totalSupply = await contract.getTotalSupply();
      expect(totalSupply).toBe(800n);
    });
  });

  describe('sendUnshielded', () => {
    beforeEach(async () => {
      // Mint initial tokens to user1
      await contract.mintUnshieldedToken(user1Wallet.address, 1000n);
    });

    it('should transfer tokens between users', async () => {
      const result = await contract.sendUnshielded(
        user2Wallet.address,
        200n,
        { wallet: user1Wallet }
      );

      expect(result).toBe(800n); // sender's remaining balance
      
      const senderBalance = await contract.getBalance(user1Wallet.address);
      const recipientBalance = await contract.getBalance(user2Wallet.address);
      
      expect(senderBalance).toBe(800n);
      expect(recipientBalance).toBe(200n);
    });

    it('should reject insufficient balance', async () => {
      await expect(
        contract.sendUnshielded(user2Wallet.address, 2000n, {
          wallet: user1Wallet,
        })
      ).rejects.toThrow('Insufficient balance');
    });

    it('should handle partial balance transfer', async () => {
      await contract.sendUnshielded(user2Wallet.address, 1000n, {
        wallet: user1Wallet,
      });

      const senderBalance = await contract.getBalance(user1Wallet.address);
      expect(senderBalance).toBe(0n);
    });
  });

  describe('receiveUnshielded', () => {
    it('should acknowledge incoming transfer', async () => {
      await contract.mintUnshieldedToken(user1Wallet.address, 500n);
      
      // Send tokens first
      await contract.sendUnshielded(user2Wallet.address, 100n, {
        wallet: user1Wallet,
      });

      // Receive acknowledgment
      const result = await contract.receiveUnshielded(
        user1Wallet.address,
        100n,
        { wallet: user2Wallet }
      );

      expect(result).toBe(100n);
    });
  });

  describe('query operations', () => {
    it('should return zero balance for new addresses', async () => {
      const balance = await contract.getBalance(user1Wallet.address);
      expect(balance).toBe(0n);
    });

    it('should return correct token color', async () => {
      const color = await contract.getTokenColor();
      expect(color).toBe('0x0000000000000000000000000000000000000000000000000000000000000001');
    });

    it('should return zero total supply initially', async () => {
      const totalSupply = await contract.getTotalSupply();
      expect(totalSupply).toBe(0n);
    });
  });
});
