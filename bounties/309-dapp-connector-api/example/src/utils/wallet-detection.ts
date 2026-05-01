# src/utils/wallet-detection.ts
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import * as semver from 'semver';

/**
 * Detect all available Midnight wallets in the browser
 */
export function detectWallets(): Array<{
  id: string;
  api: InitialAPI;
  name: string;
  icon: string;
  apiVersion: string;
}> {
  if (!window.midnight) {
    return [];
  }

  return Object.entries(window.midnight).map(([id, api]) => ({
    id,
    api,
    name: api.name,
    icon: api.icon,
    apiVersion: api.apiVersion,
  }));
}

/**
 * Filter wallets by compatible API version
 */
export function filterCompatibleWallets(
  wallets: Array<{ id: string; api: InitialAPI; name: string; icon: string; apiVersion: string }>,
  versionRange: string = '^3.0.0'
): Array<{ id: string; api: InitialAPI; name: string; icon: string; apiVersion: string }> {
  return wallets.filter((w) => semver.satisfies(w.apiVersion, versionRange));
}

/**
 * Check if any Midnight wallet is installed
 */
export function isWalletInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.midnight;
}
