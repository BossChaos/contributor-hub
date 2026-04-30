// React Frontend - Shielded Token dApp
// Implements UI for all shielded token operations with Lace wallet integration
// Uses Midnight dApp Connector API for wallet communication

import React, { useState, useEffect } from 'react';

// Types for wallet connection
interface WalletInfo {
  address: string;
  provider: 'lace' | 'one-am';
  connected: boolean;
}

// Types for token operations
interface TokenBalance {
  shielded: bigint;
  unshielded: bigint;
}

interface TransactionResult {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
}

// Utility: Generate cryptographically secure random bytes
function generateRandomBytes(length: number): Uint8Array {
  if (typeof window !== 'undefined' && window.crypto) {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return array;
  }
  throw new Error('Crypto API not available in this environment');
}

// Utility: Convert bytes to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Utility: Compute commitment (matches Compact contract's sha256)
function computeCommitment(amount: bigint, secret: Uint8Array): Uint8Array {
  // In production, use proper SHA-256 implementation
  // This is a placeholder - actual implementation depends on Midnight SDK
  const hash = new Uint8Array(32);
  // TODO: Implement proper SHA-256 using Midnight SDK
  return hash;
}

// Utility: Compute nullifier
function computeNullifier(secret: Uint8Array): Uint8Array {
  // In production, use proper SHA-256 implementation
  // This is a placeholder - actual implementation depends on Midnight SDK
  const hash = new Uint8Array(32);
  // TODO: Implement proper SHA-256 using Midnight SDK
  return hash;
}

// Utility: Compute new Merkle root
function computeNewRoot(commitment: Uint8Array): Uint8Array {
  // In production, update Merkle tree and compute new root
  // This is a placeholder - actual implementation depends on Midnight SDK
  const root = new Uint8Array(32);
  // TODO: Implement proper Merkle tree update using Midnight SDK
  return root;
}

/**
 * Detect and connect to Midnight wallet
 * Supports both Lace and 1AM wallets via dApp connector API
 * The dApp connector exposes window.midnight object
 */
async function connectWallet(): Promise<WalletInfo> {
  // Check for window.midnight (dApp connector)
  if (typeof window !== 'undefined' && (window as any).midnight) {
    const midnight = (window as any).midnight;
    
    // Detect wallet type - Lace and 1AM both use window.midnight
    // Lace adds midnight.lace property, 1AM adds midnight.oneAM
    const provider = midnight.lace ? 'lace' : 'one-am';
    
    // Request connection - this triggers wallet UI for user approval
    const result = await midnight.enable();
    
    return {
      address: result.address,
      provider,
      connected: true,
    };
  }
  
  throw new Error('Midnight wallet not found. Please install Lace or 1AM wallet.');
}

/**
 * Disconnect from wallet
 * Clears connection state but doesn't revoke permissions
 */
async function disconnectWallet(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).midnight) {
    await (window as any).midnight.disable();
  }
}

/**
 * Mint shielded tokens
 */
async function mintShieldedToken(
  amount: bigint,
  contractAddress: string
): Promise<TransactionResult> {
  // Generate witness
  const witness = {
    amount,
    secret: generateRandomBytes(32),
  };
  
  // Compute public values
  const commitment = computeCommitment(witness.amount, witness.secret);
  const newRoot = computeNewRoot(commitment);
  
  // Call contract via dApp connector
  if (typeof window !== 'undefined' && (window as any).midnight) {
    const result = await (window as any).midnight.call({
      contractAddress,
      circuit: 'mintShieldedToken',
      publicInputs: { commitment, newRoot },
      witness: {
        amount: witness.amount.toString(),
        secret: bytesToHex(witness.secret),
      },
    });
    
    return {
      txHash: result.txHash,
      status: 'pending',
    };
  }
  
  throw new Error('Wallet not connected');
}

/**
 * Send shielded tokens to another address
 */
async function sendShieldedToken(
  recipientAddress: string,
  transferAmount: bigint,
  senderBalance: bigint,
  senderSecret: Uint8Array,
  contractAddress: string
): Promise<TransactionResult> {
  // Generate witnesses
  const recipientSecret = generateRandomBytes(32);
  const changeSecret = generateRandomBytes(32);
  const changeAmount = senderBalance - transferAmount;
  
  // Compute public values
  const senderNullifier = computeNullifier(senderSecret);
  const recipientCommitment = computeCommitment(transferAmount, recipientSecret);
  const changeCommitment = computeCommitment(changeAmount, changeSecret);
  const newRoot = computeNewRoot(changeCommitment);
  
  // Call contract
  if (typeof window !== 'undefined' && (window as any).midnight) {
    const result = await (window as any).midnight.call({
      contractAddress,
      circuit: 'sendShielded',
      publicInputs: {
        senderNullifier: bytesToHex(senderNullifier),
        recipientCommitment: bytesToHex(recipientCommitment),
        changeCommitment: bytesToHex(changeCommitment),
        newRoot: bytesToHex(newRoot),
        transferAmount: transferAmount.toString(),
      },
      witness: {
        senderBalance: senderBalance.toString(),
        senderSecret: bytesToHex(senderSecret),
        recipientAmount: transferAmount.toString(),
        recipientSecret: bytesToHex(recipientSecret),
        changeAmount: changeAmount.toString(),
        changeSecret: bytesToHex(changeSecret),
      },
    });
    
    return {
      txHash: result.txHash,
      status: 'pending',
    };
  }
  
  throw new Error('Wallet not connected');
}

/**
 * Burn shielded tokens
 */
async function burnShieldedToken(
  burnAmount: bigint,
  burnSecret: Uint8Array,
  contractAddress: string
): Promise<TransactionResult> {
  // Compute public values
  const burnNullifier = computeNullifier(burnSecret);
  const newRoot = computeNewRoot(new Uint8Array(32));
  
  // Call contract
  if (typeof window !== 'undefined' && (window as any).midnight) {
    const result = await (window as any).midnight.call({
      contractAddress,
      circuit: 'shieldedBurnAddress',
      publicInputs: {
        burnNullifier: bytesToHex(burnNullifier),
        newRoot: bytesToHex(newRoot),
      },
      witness: {
        burnAmount: burnAmount.toString(),
        burnSecret: bytesToHex(burnSecret),
      },
    });
    
    return {
      txHash: result.txHash,
      status: 'pending',
    };
  }
  
  throw new Error('Wallet not connected');
}

/**
 * Main App Component
 */
const ShieldedTokenApp: React.FC = () => {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [balance, setBalance] = useState<TokenBalance>({ shielded: 0n, unshielded: 0n });
  const [txResult, setTxResult] = useState<TransactionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Contract address (deployed on testnet/mainnet)
  const CONTRACT_ADDRESS = '0x...'; // Replace with actual deployed address
  
  // Connect wallet on mount
  useEffect(() => {
    const init = async () => {
      try {
        const info = await connectWallet();
        setWallet(info);
      } catch (err: any) {
        setError(err.message);
      }
    };
    init();
  }, []);
  
  // Handle mint
  const handleMint = async (amount: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await mintShieldedToken(BigInt(amount), CONTRACT_ADDRESS);
      setTxResult(result);
      // Refresh balance
      // ...
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  // Handle send
  const handleSend = async (recipient: string, amount: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await sendShieldedToken(
        recipient,
        BigInt(amount),
        balance.shielded,
        generateRandomBytes(32), // In real app, get from wallet
        CONTRACT_ADDRESS
      );
      setTxResult(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  // Handle burn
  const handleBurn = async (amount: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await burnShieldedToken(
        BigInt(amount),
        generateRandomBytes(32), // In real app, get from wallet
        CONTRACT_ADDRESS
      );
      setTxResult(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="container">
      <h1>Shielded Token dApp</h1>
      
      {/* Wallet Connection Status */}
      <div className="wallet-status">
        {wallet ? (
          <div>
            <p>Connected: {wallet.address.slice(0, 10)}...{wallet.address.slice(-8)}</p>
            <p>Provider: {wallet.provider}</p>
            <p>Shielded Balance: {balance.shielded.toString()}</p>
          </div>
        ) : (
          <button onClick={() => connectWallet().then(setWallet)}>
            Connect Wallet
          </button>
        )}
      </div>
      
      {/* Error Display */}
      {error && <div className="error">{error}</div>}
      
      {/* Transaction Result */}
      {txResult && (
        <div className="tx-result">
          <h3>Transaction</h3>
          <p>Hash: {txResult.txHash}</p>
          <p>Status: {txResult.status}</p>
        </div>
      )}
      
      {/* Operations */}
      <div className="operations">
        <h2>Operations</h2>
        
        <div className="operation-group">
          <h3>Mint Shielded Token</h3>
          <button onClick={() => handleMint(100)} disabled={loading}>
            Mint 100 (Test)
          </button>
        </div>
        
        <div className="operation-group">
          <h3>Send Shielded Token</h3>
          <input type="text" placeholder="Recipient Address" />
          <input type="number" placeholder="Amount" />
          <button onClick={() => handleSend('0x...', 10)} disabled={loading}>
            Send
          </button>
        </div>
        
        <div className="operation-group">
          <h3>Burn Shielded Token</h3>
          <input type="number" placeholder="Amount to Burn" />
          <button onClick={() => handleBurn(10)} disabled={loading}>
            Burn
          </button>
        </div>
      </div>
      
      {/* Loading Indicator */}
      {loading && <div className="loading">Processing transaction...</div>}
    </div>
  );
};

// Utility functions
function generateRandomBytes(length: number): Uint8Array {
  if (typeof window !== 'undefined' && window.crypto) {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return array;
  }
  throw new Error('Crypto not available');
}

function computeCommitment(amount: bigint, secret: Uint8Array): Uint8Array {
  // In real implementation, use proper hash function
  return new Uint8Array(32);
}

function computeNullifier(secret: Uint8Array): Uint8Array {
  // In real implementation, use proper hash function
  return new Uint8Array(32);
}

function computeNewRoot(commitment: Uint8Array): Uint8Array {
  // In real implementation, update Merkle tree
  return new Uint8Array(32);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export default ShieldedTokenApp;
