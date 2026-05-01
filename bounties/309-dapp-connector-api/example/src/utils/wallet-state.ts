# src/utils/wallet-state.ts
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

export interface WalletConfig {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri: string;
  substrateNodeUri: string;
  networkId: string;
}

export interface WalletBalances {
  shieldedBalances: Record<string, bigint>;
  unshieldedBalances: Record<string, bigint>;
  dustBalance: bigint;
}

export interface WalletAddresses {
  shieldedAddress: string;
  unshieldedAddress: string;
  dustAddress: string;
}

/**
 * Retrieve service URI configuration from wallet
 */
export async function getWalletConfig(api: ConnectedAPI): Promise<WalletConfig> {
  return api.getConfiguration();
}

/**
 * Get all wallet balances
 */
export async function getWalletBalances(api: ConnectedAPI): Promise<WalletBalances> {
  const [shieldedBalances, unshieldedBalances, dustBalance] = await Promise.all([
    api.getShieldedBalances(),
    api.getUnshieldedBalances(),
    api.getDustBalance(),
  ]);

  return { shieldedBalances, unshieldedBalances, dustBalance };
}

/**
 * Get all wallet addresses (Bech32m format)
 */
export async function getWalletAddresses(api: ConnectedAPI): Promise<WalletAddresses> {
  const shieldedAddresses = await api.getShieldedAddresses();
  const unshieldedAddress = await api.getUnshieldedAddress();
  const dustAddress = await api.getDustAddress();

  return {
    shieldedAddress: shieldedAddresses.shieldedAddress,
    unshieldedAddress,
    dustAddress,
  };
}
