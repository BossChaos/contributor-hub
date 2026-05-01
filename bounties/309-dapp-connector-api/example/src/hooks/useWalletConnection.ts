# src/hooks/useWalletConnection.ts
import { useState, useCallback } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { detectWallets, filterCompatibleWallets } from '../utils/wallet-detection';
import { connectWallet, type NetworkId } from '../utils/wallet-connection';

export function useWalletConnection(networkId: NetworkId = 'preprod') {
  const [connectedApi, setConnectedApi] = useState<ConnectedAPI | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (walletId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const wallets = detectWallets();
      const compatible = filterCompatibleWallets(wallets);

      if (compatible.length === 0) {
        throw new Error('No compatible wallets found. Please install Midnight Lace.');
      }

      const selectedWallet = compatible.find((w) => w.id === walletId);
      if (!selectedWallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      const api = await connectWallet(selectedWallet.api, networkId);
      setConnectedApi(api);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsLoading(false);
    }
  }, [networkId]);

  const disconnect = useCallback(() => {
    setConnectedApi(null);
    setError(null);
  }, []);

  return { connectedApi, isLoading, error, connect, disconnect };
}
