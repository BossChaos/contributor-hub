// Test suite for Unshielded Token dApp
// Tests mint, send, receive, and query operations
//
// Run with: npm test
// Requires: @midnight-js/dapp-connector, @midnight-js/ledger

import { describe, it, expect, beforeEach } from 'vitest';

// Mock wallet factory for testing
// In production, use the actual Midnight wallet SDK
const createTestWallet = async () => {
  // Generate a random 32-byte address for testing
  const address = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256)
  );
  return {
    address: '0x' + Array.from(address, b => b.toString(16).padStart(2, '0')).join(''),
    privateKey: Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256)
    ),
  };
};

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

    // Deploy contract with owner and token color
    // In production: await UnshieldedToken.deploy({ owner, tokenColor })
    contract = {
      owner: ownerWallet.address,
      tokenColor: '0x0000000000000000000000000000000000000000000000000000000000000001',
      balances: new Map(),
      totalSupply: 0n,

      // Mint Operation
      mintUnshieldedToken: async (recipient, amount, options = {}) => {
        const caller = options.wallet?.address || contract.owner;
        if (caller !== contract.owner) {
          throw new Error('Only owner can mint');
        }
        if (amount <= 0n) {
          throw new Error('Amount must be positive');
        }
        const currentBalance = contract.balances.get(recipient) || 0n;
        const newBalance = currentBalance + amount;
        contract.balances.set(recipient, newBalance);
        contract.totalSupply += amount;
        return newBalance;
      },

      // Send Operation
      sendUnshielded: async (recipient, amount, options = {}) => {
        const sender = options.wallet?.address;
        if (!sender) throw new Error('Sender wallet required');
        if (amount <= 0n) {
          throw new Error('Amount must be positive');
        }
        const senderBalance = contract.balances.get(sender) || 0n;
        if (senderBalance < amount) {
          throw new Error('Insufficient balance');
        }
        contract.balances.set(sender, senderBalance - amount);
        const recipientBalance = contract.balances.get(recipient) || 0n;
        contract.balances.set(recipient, recipientBalance + amount);
        return senderBalance - amount;
      },

      // Receive Operation (acknowledgment only)
      receiveUnshielded: async (sender, amount, options = {}) => {
        const recipient = options.wallet?.address;
        if (!recipient) throw new Error('Recipient wallet required');
        if (amount <= 0n) {
          throw new Error('Amount must be positive');
        }
        const currentBalance = contract.balances.get(recipient) || 0n;
        if (currentBalance < amount) {
          throw new Error('Transfer not found on chain');
        }
        return currentBalance;
      },

      // Query Operations
      getBalance: async (address) => {
        return contract.balances.get(address) || 0n;
      },

      getTotalSupply: async () => {
        return contract.totalSupply;
      },

      getTokenColor: async () => {
        return contract.tokenColor;
      },
    };
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

    it('should accumulate balance for repeated mints to same address', async () => {
      await contract.mintUnshieldedToken(user1Wallet.address, 500n);
      await contract.mintUnshieldedToken(user1Wallet.address, 300n);

      const balance = await contract.getBalance(user1Wallet.address);
      expect(balance).toBe(800n);
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

    it('should preserve total supply after transfer', async () => {
      await contract.sendUnshielded(user2Wallet.address, 500n, {
        wallet: user1Wallet,
      });

      const totalSupply = await contract.getTotalSupply();
      expect(totalSupply).toBe(1000n); // unchanged
    });
  });

  describe('receiveUnshielded', () => {
    it('should acknowledge incoming transfer', async () => {
      await contract.mintUnshieldedToken(user1Wallet.address, 500n);

      // Send tokens first
      await contract.sendUnshielded(user2Wallet.address, 100n, {
        wallet: user1Wallet,
      });

      // Receive acknowledgment (balance already updated by send)
      const result = await contract.receiveUnshielded(
        user1Wallet.address,
        100n,
        { wallet: user2Wallet }
      );

      expect(result).toBe(100n); // recipient's balance after send
    });

    it('should reject if no transfer was made', async () => {
      await expect(
        contract.receiveUnshielded(user1Wallet.address, 100n, {
          wallet: user2Wallet,
        })
      ).rejects.toThrow('Transfer not found on chain');
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
