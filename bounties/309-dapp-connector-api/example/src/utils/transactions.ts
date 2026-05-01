# src/utils/transactions.ts
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

/**
 * Create and submit a simple NIGHT transfer
 */
export async function sendNight(
  api: ConnectedAPI,
  recipient: string,
  amountNights: number
): Promise<string> {
  // Convert NIGHT to mutts (1 NIGHT = 10^8 mutts)
  const amountMutts = BigInt(amountNights) * BigInt(10 ** 8);

  // Create transfer intent
  const tx = await api.makeTransfer([
    {
      kind: 'unshielded',
      type: 'native', // Native token type
      value: amountMutts,
      recipient,
    },
  ]);

  // Submit transaction
  await api.submitTransaction(tx);

  return tx;
}

/**
 * Create a two-party swap transaction
 * Party A sends unshielded, Party B receives shielded
 */
export async function createSwapTransaction(
  api: ConnectedAPI,
  recipientShielded: string,
  sendAmount: bigint,
  receiveAmount: bigint,
  tokenType: string
): Promise<string> {
  // Party #1 creates unbalanced intent
  const tx = await api.makeIntent(
    // Outputs (what Party A sends)
    [{ kind: 'unshielded', type: 'native', value: sendAmount }],
    // Calls (contract interactions - empty for simple transfer)
    [],
    // Inputs (what Party A receives)
    [{ kind: 'shielded', type: tokenType, value: receiveAmount, recipient: recipientShielded }]
  );

  return tx;
}

/**
 * Party #2 balances and submits the transaction
 */
export async function balanceAndSubmit(
  api: ConnectedAPI,
  unbalancedTx: string
): Promise<void> {
  // Balance the transaction (Party B's side)
  const balancedTx = await api.balanceSealedTransaction(unbalancedTx);

  // Submit to network
  await api.submitTransaction(balancedTx);
}
