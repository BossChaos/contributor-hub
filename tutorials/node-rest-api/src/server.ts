import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { LevelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { deployContract, getStates, getPublicStates } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

dotenv.config();

// ─── Network Configuration ───
const network = (process.env.NETWORK || 'testnet') as 'testnet' | 'preprod' | 'mainnet';
setNetworkId(network);

// ─── Provider Assembly ───
const zkConfigProvider = new NodeZkConfigProvider(
  process.env.ZK_ARTIFACTS_PATH || '/var/midnight/zk-artifacts'
);

const privateStateProvider = new LevelPrivateStateProvider({
  privateStoragePasswordProvider: async () => process.env.STATE_PASSWORD!,
  accountId: process.env.WALLET_ADDRESS!,
});

const publicDataProvider = indexerPublicDataProvider(
  process.env.INDEXER_QUERY_URL!,
  process.env.INDEXER_SUBSCRIPTION_URL!
);

const proofProvider = httpClientProofProvider(
  process.env.PROOF_SERVER_URL!,
  zkConfigProvider
);

// Placeholder — replace with actual wallet/midnight providers from @midnight-ntwrk/wallet-sdk-facade
const walletProvider = {} as any;
const midnightProvider = {} as any;

const providers: MidnightProviders = {
  privateStateProvider,
  publicDataProvider,
  zkConfigProvider,
  proofProvider,
  walletProvider,
  midnightProvider,
};

// ─── Express App Setup ───
const app = express();
app.use(cors());
app.use(express.json());

// Store deployed contract references
const contracts = new Map<string, any>();

// ─── Utility: Timeout Wrapper ───
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(
      new Error(`${operation} timed out after ${timeoutMs}ms`)
    ), timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

// ─── Utility: Retry Logic ───
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.message.includes('invalid') ||
          lastError.message.includes('unauthorized')) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

// ─── Health Check ───
app.get('/api/health', async (_req: Request, res: Response) => {
  const health = {
    status: 'ok',
    proofServer: false,
    nodeRpc: false,
    indexer: false,
  };

  try {
    await fetch(process.env.PROOF_SERVER_URL! + '/health', {
      signal: AbortSignal.timeout(5000),
    });
    health.proofServer = true;
  } catch {
    health.status = 'degraded';
  }

  try {
    const response = await fetch(process.env.NODE_RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'system_health',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    health.nodeRpc = response.ok;
  } catch {
    health.status = 'degraded';
  }

  res.json(health);
});

// ─── Deploy Contract ───
app.post('/api/contracts/deploy', async (req: Request, res: Response) => {
  try {
    const { compiledContract, privateStateId, initialPrivateState } = req.body;

    const deployed = await withTimeout(
      deployContract(providers, {
        compiledContract,
        privateStateId,
        initialPrivateState,
      }),
      120_000,
      'Contract deployment'
    );

    contracts.set(privateStateId, deployed);

    res.json({
      success: true,
      contractAddress: deployed.contractAddress,
      privateStateId,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      return res.status(408).json({
        success: false,
        error: 'Contract deployment timed out.',
      });
    }
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ─── Call Contract Circuit ───
app.post('/api/contracts/:privateStateId/call', async (req: Request, res: Response) => {
  try {
    const { privateStateId } = req.params;
    const { circuitName, args } = req.body;

    const deployed = contracts.get(privateStateId);
    if (!deployed) {
      return res.status(404).json({
        success: false,
        error: `Contract ${privateStateId} not found`,
      });
    }

    const result = await withRetry(
      () => withTimeout(
        deployed.callTx[circuitName](...args),
        120_000,
        'Proof generation'
      ),
      3,
      2000
    );

    res.json({
      success: true,
      transactionHash: result.transactionHash,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      return res.status(408).json({
        success: false,
        error: 'Proof generation timed out. The proof server may be overloaded.',
      });
    }
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ─── Query Contract State ───
app.get('/api/contracts/:privateStateId/state', async (req: Request, res: Response) => {
  try {
    const { privateStateId } = req.params;
    const deployed = contracts.get(privateStateId);

    if (!deployed) {
      return res.status(404).json({
        success: false,
        error: `Contract ${privateStateId} not found`,
      });
    }

    const state = await deployed.getPrivateState();
    res.json({ success: true, state });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ─── Start Server ───
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`Midnight REST API listening on port ${PORT}`);
  console.log(`Network: ${network}`);
  console.log(`Proof Server: ${process.env.PROOF_SERVER_URL}`);
});

export default app;
