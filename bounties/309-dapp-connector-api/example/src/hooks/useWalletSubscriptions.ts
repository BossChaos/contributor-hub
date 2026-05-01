# src/hooks/useWalletSubscriptions.ts
import { useState, useEffect } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  subscribeToShieldedBalances,
  subscribeToUnshieldedBalances,
} from '../utils/subscriptions';

export function useWalletSubscriptions(api: ConnectedAPI | null) {
  const [shieldedBalances, setShieldedBalances] = useState<Record<string, bigint>>({});
  const [unshieldedBalances, setUnshieldedBalances] = useState<Record<string, bigint>>({});

  useEffect(() => {
    if (!api) return;

    // Subscribe to shielded balances
    const unsubscribeShielded = subscribeToShieldedBalances(api, (balances) => {
      setShieldedBalances(balances);
    });

    // Subscribe to unshielded balances
    const unsubscribeUnshielded = subscribeToUnshieldedBalances(api, (balances) => {
      setUnshieldedBalances(balances);
    });

    // Cleanup on unmount
    return () => {
      unsubscribeShielded();
      unsubscribeUnshielded();
    };
  }, [api]);

  return { shieldedBalances, unshieldedBalances };
}
