/**
 * Backend server for PrivateVoting dApp.
 *
 * This Express server handles:
 * 1. Proof generation coordination (calls Midnight proof server)
 * 2. Off-chain data storage (election metadata, voter status)
 * 3. Transaction submission to the Midnight ledger
 *
 * In a production dApp, this backend would run on a server with
 * access to the Midnight node and proof server.
 */

import express from 'express';
import cors from 'cors';
import { generateVoteWitness, generateSecretKey } from './voting-witness';

const app = express();
app.use(cors());
app.use(express.json());

// Off-chain data store (in production, use a database)
interface Election {
    id: string;
    contractAddress: string;
    optionA: string;
    optionB: string;
    isOpen: boolean;
    totalVoters: number;
}

interface Voter {
    secretKey: string;
    hasVoted: boolean;
}

// In-memory stores
const elections: Map<string, Election> = new Map();
const voters: Map<string, Voter> = new Map();

/**
 * POST /api/election/create
 *
 * Create a new election. In production, this would interact with
 * the contract deployment pipeline.
 */
app.post('/api/election/create', (req, res) => {
    const { electionId, optionA, optionB } = req.body;

    const election: Election = {
        id: electionId,
        contractAddress: '', // Set after contract deployment
        optionA,
        optionB,
        isOpen: true,
        totalVoters: 0,
    };

    elections.set(electionId, election);
    res.json({ success: true, election });
});

/**
 * GET /api/election/:id
 *
 * Get election details from off-chain store.
 */
app.get('/api/election/:id', (req, res) => {
    const election = elections.get(req.params.id);
    if (!election) {
        return res.status(404).json({ error: 'Election not found' });
    }
    res.json(election);
});

/**
 * POST /api/voter/register
 *
 * Register a new voter and generate their secret key.
 * The secret key is returned to the client and should be stored
 * securely (e.g., in the browser's secure storage or a hardware wallet).
 */
app.post('/api/voter/register', (req, res) => {
    const { voterId } = req.body;

    const secretKey = generateSecretKey();
    const voter: Voter = {
        secretKey,
        hasVoted: false,
    };

    voters.set(voterId, voter);
    res.json({ success: true, secretKey });
});

/**
 * POST /api/vote/witness
 *
 * Generate witness data for casting a vote.
 * This is the critical step where the client prepares the private
 * inputs needed for the ZK proof.
 */
app.post('/api/vote/witness', (req, res) => {
    const { voterId, electionId, voteValue } = req.body;

    const voter = voters.get(voterId);
    if (!voter) {
        return res.status(404).json({ error: 'Voter not registered' });
    }

    if (voter.hasVoted) {
        return res.status(400).json({ error: 'Already voted' });
    }

    const witness = generateVoteWitness(voter.secretKey, electionId, voteValue);
    res.json({ success: true, witness });
});

/**
 * POST /api/transaction/submit
 *
 * Submit a transaction to the Midnight ledger.
 * In production, this would use the Midnight dApp toolkit to:
 * 1. Connect to the wallet (Lace or 1AM)
 * 2. Generate the ZK proof via the proof server
 * 3. Submit the transaction to the ledger
 */
app.post('/api/transaction/submit', async (req, res) => {
    const { contractAddress, functionName, args } = req.body;

    // In production, this would:
    // 1. Use midnight-js to connect to the wallet
    // 2. Call the contract function with the provided arguments
    // 3. The proof server would generate the ZK proof
    // 4. The transaction would be submitted to the ledger

    // For demo purposes, return a mock transaction hash
    res.json({
        success: true,
        txHash: '0x' + Math.random().toString(16).slice(2, 66),
        functionName,
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`PrivateVoting backend running on port ${PORT}`);
});
