# src/App.tsx
import React, { useState, useEffect } from 'react';
import { useWalletConnection } from './hooks/useWalletConnection';
import { useWalletState } from './hooks/useWalletState';
import { useWalletSubscriptions } from './hooks/useWalletSubscriptions';
import { detectWallets, filterCompatibleWallets, isWalletInstalled } from './utils/wallet-detection';
import { sendNight } from './utils/transactions';
import type { NetworkId } from './utils/wallet-connection';

const App: React.FC = () => {
  const networkId: NetworkId = 'preprod';
  const { connectedApi, isLoading, error, connect, disconnect } = useWalletConnection(networkId);
  const { balances, addresses } = useWalletState(connectedApi);
  const { shieldedBalances, unshieldedBalances } = useWalletSubscriptions(connectedApi);

  const [availableWallets, setAvailableWallets] = useState<Array<{
    id: string;
    name: string;
    icon: string;
    apiVersion: string;
  }>>([]);

  // Detect wallets on mount
  useEffect(() => {
    if (!isWalletInstalled()) {
      console.warn('No Midnight wallet detected. Please install Midnight Lace.');
      return;
    }

    const wallets = detectWallets();
    const compatible = filterCompatibleWallets(wallets);
    setAvailableWallets(compatible.map((w) => ({
      id: w.id,
      name: w.name,
      icon: w.icon,
      apiVersion: w.apiVersion,
    })));
  }, []);

  const handleSendNight = async () => {
    if (!connectedApi || !addresses.unshielded) return;

    try {
      await sendNight(connectedApi, addresses.unshielded, 0.1); // Send 0.1 NIGHT
      console.log('Transaction submitted successfully');
    } catch (error) {
      console.error('Transaction failed:', error);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Midnight DApp Wallet Connector</h1>

      {/* Wallet Detection */}
      <section>
        <h2>Available Wallets</h2>
        {availableWallets.length === 0 ? (
          <p>No compatible wallets found. <a href="https://midnight.network/developers/lace-wallet" target="_blank">Install Midnight Lace</a></p>
        ) : (
          <div>
            {availableWallets.map((wallet) => (
              <div key={wallet.id} style={{ marginBottom: '10px' }}>
                <img src={wallet.icon} alt={wallet.name} style={{ width: 24, height: 24, marginRight: 8 }} />
                <span>{wallet.name} (v{wallet.apiVersion})</span>
                {!connectedApi && (
                  <button onClick={() => connect(wallet.id)} disabled={isLoading}>
                    {isLoading ? 'Connecting...' : 'Connect'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Connection Status */}
      {error && (
        <section style={{ color: 'red', marginTop: '20px' }}>
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      )}

      {/* Wallet State */}
      {connectedApi && (
        <section style={{ marginTop: '20px' }}>
          <h2>Wallet Connected</h2>
          <p><strong>Shielded Address:</strong> {addresses.shielded || 'N/A'}</p>
          <p><strong>Unshielded Address:</strong> {addresses.unshielded || 'N/A'}</p>

          <h3>Shielded Balances</h3>
          <pre>{JSON.stringify(shieldedBalances, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2)}</pre>

          <h3>Unshielded Balances</h3>
          <pre>{JSON.stringify(unshieldedBalances, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2)}</pre>

          <button onClick={handleSendNight}>Send 0.1 NIGHT</button>
          <button onClick={disconnect} style={{ marginLeft: '10px' }}>Disconnect</button>
        </section>
      )}
    </div>
  );
};

export default App;
