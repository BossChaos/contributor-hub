# src/utils/error-handling.ts

export class WalletError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

/**
 * Handle common wallet errors gracefully
 */
export function handleWalletError(error: unknown): WalletError {
  if (error instanceof WalletError) return error;

  if (error instanceof Error) {
    // User rejected connection
    if (error.message.includes('rejected')) {
      return new WalletError('Connection rejected by user', 'USER_REJECTED', error);
    }

    // Network mismatch
    if (error.message.includes('Network mismatch')) {
      return new WalletError('Network mismatch. Please switch networks in your wallet.', 'NETWORK_MISMATCH', error);
    }

    // Insufficient balance
    if (error.message.includes('insufficient')) {
      return new WalletError('Insufficient balance for transaction', 'INSUFFICIENT_BALANCE', error);
    }
  }

  return new WalletError('Unknown wallet error', 'UNKNOWN', error);
}
