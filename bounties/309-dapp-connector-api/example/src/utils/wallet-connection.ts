# src/utils/wallet-connection.ts
import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

export type NetworkId = 'mainnet' | 'preprod' | 'testnet' | 'undeployed';

/**
 * Connect to a Midnight wallet
 */
export async function connectWallet(
  wallet: InitialAPI,
  networkId: NetworkId
): Promise<ConnectedAPI> {
  try {
    // Initiate connection - may trigger wallet UI for user authorization
    const connectedApi = await wallet.connect(networkId);

    // Verify connection was successful
    const connectionStatus = await connectedApi.getConnectionStatus();
    if (!connectionStatus.connected) {
      throw new Error('Wallet connection rejected by user');
    }

    // Verify we're on the expected network
    if (connectionStatus.networkId !== networkId) {
      throw new Error(
        `Network mismatch: expected ${networkId}, got ${connectionStatus.networkId}`
      );
    }

    return connectedApi;
  } catch (error) {
    console.error('Wallet connection failed:', error);
    throw error;
  }
}
