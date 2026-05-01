# src/hooks/useWalletState.ts
import { useState, useEffect } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { getWalletBalances, getWalletAddresses } from '../utils/wallet-state';

export function useWalletState(api: ConnectedAPI | null) {
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [addresses, setAddresses] = useState<{
    shielded: string | null;
    unshielded: string | null;
  }>({ shielded: null, unshielded: null });

  useEffect(() => {
    if (!api) return;

    const fetchState = async () => {
      try {
        const [walletBalances, walletAddresses] = await Promise.all([
          getWalletBalances(api),
          getWalletAddresses(api),
        ]);

        setBalances(walletBalances.shieldedBalances);
        setAddresses({
          shielded: walletAddresses.shieldedAddress,
          unshielded: walletAddresses.unshieldedAddress,
        });
      } catch (error) {
        console.error('Failed to fetch wallet state:', error);
      }
    };

    fetchState();
  }, [api]);

  return { balances, addresses };
}
