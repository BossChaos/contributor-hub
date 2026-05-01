# src/utils/subscriptions.ts
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Subscribe to shielded balance changes
 */
export function subscribeToShieldedBalances(
  api: ConnectedAPI,
  callback: (balances: Record<string, bigint>) => void
): () => void {
  const subscription = api.subscribeToShieldedBalances({
    onNext: (balances) => {
      callback(balances);
    },
    onError: (error) => {
      console.error('Balance subscription error:', error);
    },
    onCompleted: () => {
      console.log('Balance subscription completed');
    },
  });

  // Return unsubscribe function
  return () => subscription.unsubscribe();
}

/**
 * Subscribe to unshielded balance changes
 */
export function subscribeToUnshieldedBalances(
  api: ConnectedAPI,
  callback: (balances: Record<string, bigint>) => void
): () => void {
  const subscription = api.subscribeToUnshieldedBalances({
    onNext: (balances) => {
      callback(balances);
    },
    onError: (error) => {
      console.error('Unshielded balance subscription error:', error);
    },
    onCompleted: () => {
      console.log('Unshielded balance subscription completed');
    },
  });

  return () => subscription.unsubscribe();
}
