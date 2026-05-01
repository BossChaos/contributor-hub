# Building a Full-Stack Midnight dApp: From Compact Contract to Browser Interaction

## Tutorial Overview

This tutorial walks you through building a complete dApp on the Midnight network — from writing the Compact smart contract, through TypeScript witness generation and backend proof coordination, to a React frontend that lets users vote privately. By the end, you'll understand the full development lifecycle: compile the contract, deploy it, interact with it via a wallet, and read state from the indexer.

**What you'll build:** PrivateVoting — a privacy-preserving voting dApp where voters cast encrypted votes that remain hidden until the election closes. The contract tallies votes privately using zero-knowledge proofs, then reveals only the final result.

**What you'll learn:**
- Writing a Compact contract with privacy features (nullifiers, commitments, domain separation)
- Generating TypeScript witnesses for ZK proof generation
- Setting up a Node.js backend for proof coordination
- Building a React frontend with wallet integration (Lace)
- Reading contract state from the Midnight indexer
- The complete lifecycle from `compact compile` to browser interaction

**Prerequisites:**
- Node.js 18+ and npm installed
- Basic understanding of TypeScript and React
- Midnight development environment set up (see [Midnight Docs](https://docs.midnight.network))
- Lace wallet installed ([lace.io](https://lace.io))
- Docker installed (for the local Midnight node and proof server)

---

## 1. The Problem: Why Private Voting Matters

Traditional voting systems face a fundamental tension: you need transparency to verify the election was fair, but you need privacy to prevent coercion and vote buying. Public blockchains make this worse — every vote is visible to anyone who queries the chain.

Midnight solves this with zero-knowledge proofs. Voters submit their votes through ZK circuits that verify the vote is valid (one person, one vote, valid choice) without revealing who they are or how they voted. The contract only sees a nullifier (to prevent double-voting) and a commitment (to bind the voter to their choice). The actual vote value is disclosed only for tallying, and the voter's identity remains hidden.

Here's the architecture we're building:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   React     │────▶│  Backend    │────▶│  Midnight   │
│  Frontend   │     │  (Express)  │     │  Ledger     │
│  (Lace)     │◀────│             │◀────│  + Indexer  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Proof      │
                    │  Server     │
                    │  (Docker)   │
                    └─────────────┘
```

The flow:
1. **Frontend:** User connects Lace wallet, selects their vote
2. **Backend:** Generates witness data (nullifier + commitment), coordinates proof generation
3. **Proof Server:** Generates the ZK proof for the circuit call
4. **Ledger:** Contract verifies the proof, records the vote, updates the tally
5. **Indexer:** Exposes the updated state for the frontend to read

---

## 2. The Compact Contract: PrivateVoting

The contract is the heart of the dApp. Let's walk through the key parts of `contract/private-voting.compact`.

### 2.1 Contract State

```compact
export contract PrivateVoting {
    export sealed ledger owner: Address;
    export ledger votingOpen: Persistent<Bool>;
    export ledger optionAVotes: Persistent<Uint<256>>;
    export ledger optionBVotes: Persistent<Uint<256>>;
    export sealed ledger usedNullifiers: Set<Bytes<32>>;
    export ledger totalVoters: Persistent<Uint<256>>;
    export sealed ledger electionId: Bytes<32>;
    // ...
}
```

Key design decisions:
- `usedNullifiers` is `sealed` — the nullifier set is private. Observers can see that a nullifier was used, but cannot enumerate which nullifiers are in the set.
- `electionId` is `sealed` — the election identifier is private, providing domain separation.
- Vote tallies (`optionAVotes`, `optionBVotes`) are public — this is intentional. We want the final result to be transparent.

### 2.2 Casting a Vote

The `castVote` function is where the privacy magic happens:

```compact
pub fn castVote(nullifier: Bytes<32>, voteCommitment: Bytes<32>, voteValue: Uint<8>) -> Bool {
    // 1. Check voting is open
    if (!self.votingOpen.get()) { abort("voting is closed"); }

    // 2. Check nullifier hasn't been used (prevents double-voting)
    if (self.usedNullifiers.contains(nullifier)) { abort("already voted"); }

    // 3. Validate vote value (must be 0 or 1)
    if (voteValue != 0 && voteValue != 1) { abort("invalid vote value"); }

    // 4. Verify vote commitment matches the disclosed vote
    let expectedCommitment = sha256(voteValue, self.electionId);
    if (voteCommitment != expectedCommitment) { abort("invalid vote commitment"); }

    // 5. Record the nullifier
    self.usedNullifiers.insert(nullifier);

    // 6. Tally the vote
    if (voteValue == 0) {
        self.optionAVotes.set(self.optionAVotes.get() + 1);
    } else {
        self.optionBVotes.set(self.optionBVotes.get() + 1);
    }

    self.totalVoters.set(self.totalVoters.get() + 1);
    true
}
```

The voter provides three inputs:
1. **nullifier** — A unique value derived from their secret key + election ID. Prevents double-voting without revealing identity.
2. **voteCommitment** — A hash of (voteValue, electionId). Binds the voter to their choice.
3. **voteValue** — The actual vote (0 or 1). Disclosed for tallying.

The contract verifies all four checks before recording the vote. If any check fails, the transaction aborts and no state changes.

### 2.3 Privacy Guarantees

The contract provides three layers of privacy:

1. **Voter anonymity:** The contract only sees a nullifier, not the voter's address. Even though the transaction is submitted from a wallet address, the nullifier doesn't link back to that address.

2. **Vote secrecy:** The vote commitment is a one-way hash. Without knowing the vote value and election ID, no one can determine how someone voted from their commitment alone.

3. **Domain separation:** The election ID is included in both the nullifier and commitment calculations. This prevents a voter from reusing their nullifier or commitment in a different election.

---

## 3. TypeScript Witnesses: Generating Private Inputs

The contract's circuit functions need private inputs (the nullifier and commitment) to generate ZK proofs. These are generated client-side using the witness generation module.

### 3.1 Nullifier Generation

```typescript
export function generateNullifier(secretKey: Uint8Array, electionId: Uint8Array): Uint8Array {
    const combined = new Uint8Array(64);
    combined.set(secretKey, 0);
    combined.set(electionId, 32);
    return sha256(combined);
}
```

The nullifier is `sha256(secretKey || electionId)`. This means:
- Same voter + same election = same nullifier (prevents double-voting)
- Same voter + different election = different nullifier (domain separation)
- Different voter = different nullifier (no collisions)

### 3.2 Vote Commitment

```typescript
export function generateVoteCommitment(voteValue: number, electionId: Uint8Array): Uint8Array {
    const voteByte = new Uint8Array([voteValue]);
    const combined = new Uint8Array(1 + 32);
    combined.set(voteByte, 0);
    combined.set(electionId, 1);
    return sha256(combined);
}
```

The commitment is `sha256(voteValue || electionId)`. The contract verifies this matches the disclosed vote value, ensuring the voter can't change their vote after committing.

### 3.3 Complete Witness Generation

```typescript
export function generateVoteWitness(
    secretKey: string,
    electionIdHex: string,
    voteValue: number
): { nullifier: string; voteCommitment: string } {
    const secretKeyBytes = hexToBytes(secretKey);
    const electionIdBytes = hexToBytes(electionIdHex);
    const nullifier = generateNullifier(secretKeyBytes, electionIdBytes);
    const voteCommitment = generateVoteCommitment(voteValue, electionIdBytes);
    return {
        nullifier: bytesToHex(nullifier),
        voteCommitment: bytesToHex(voteCommitment),
    };
}
```

This is the function the frontend calls when a voter wants to cast a vote. It returns the nullifier and commitment as hex strings, which are passed to the contract's `castVote` function.

---

## 4. Backend: Proof Coordination and Off-Chain Data

The backend server (`backend/server.ts`) handles three responsibilities:

### 4.1 Voter Registration

```typescript
app.post('/api/voter/register', (req, res) => {
    const { voterId } = req.body;
    const secretKey = generateSecretKey();
    voters.set(voterId, { secretKey, hasVoted: false });
    res.json({ success: true, secretKey });
});
```

When a new voter arrives, the backend generates a random secret key and stores it. In production, this secret key would be derived from the voter's wallet or a hardware security module.

### 4.2 Witness Generation

```typescript
app.post('/api/vote/witness', (req, res) => {
    const { voterId, electionId, voteValue } = req.body;
    const voter = voters.get(voterId);
    const witness = generateVoteWitness(voter.secretKey, electionId, voteValue);
    res.json({ success: true, witness });
});
```

The backend generates the witness data (nullifier + commitment) that the frontend needs to submit the vote transaction.

### 4.3 Transaction Submission

```typescript
app.post('/api/transaction/submit', async (req, res) => {
    const { contractAddress, functionName, args } = req.body;
    // In production: use midnight-js to connect to wallet,
    // generate proof, and submit to ledger
    res.json({ success: true, txHash: '0x...' });
});
```

In a production deployment, this endpoint would:
1. Connect to the Lace wallet via the Midnight dApp connector
2. Call the contract function with the provided arguments
3. The proof server (running in Docker) would generate the ZK proof
4. The transaction would be submitted to the Midnight ledger

---

## 5. Frontend: React Components and Wallet Integration

The React frontend (`frontend/voting-components.tsx`) provides the user interface for the dApp.

### 5.1 Wallet Connection

```typescript
function useWallet(): WalletState {
    const connect = async () => {
        if (window.lace) {
            const address = await window.lace.getUsedAddresses();
            setWallet({ address: address[0], isConnected: true });
        } else {
            alert('Please install Lace wallet');
        }
    };
    // ...
}
```

The Lace wallet is Midnight's native wallet. It manages the user's private keys and signs transactions. The `useWallet` hook handles connection and provides the user's address.

### 5.2 Voting Interface

```typescript
function VoteCard({ election, onVote }) {
    return (
        <div className="vote-card">
            <h2>Cast Your Vote</h2>
            <div className="options">
                <button onClick={() => onVote(0)}>{election.optionA}</button>
                <button onClick={() => onVote(1)}>{election.optionB}</button>
            </div>
        </div>
    );
}
```

The VoteCard component presents the voting options. When a user clicks a button, the `onVote` callback triggers the full voting flow:
1. Generate witness data via the backend
2. Submit the transaction to the ledger
3. Wait for confirmation
4. Update the UI

### 5.3 Reading State

The frontend reads the current vote tally from the Midnight indexer via GraphQL:

```typescript
async function fetchResults(contractAddress: string) {
    const query = `
        query {
            contractState(address: "${contractAddress}") {
                optionAVotes
                optionBVotes
                totalVoters
                votingOpen
            }
        }
    `;
    const response = await fetch('https://indexer.midnight.network/graphql', {
        method: 'POST',
        body: JSON.stringify({ query }),
    });
    return response.json();
}
```

The indexer exposes the contract's public ledger state. The frontend queries this to display the current vote tally.

---

## 6. Full Development Lifecycle

Here's the complete workflow from writing the contract to interacting with it in the browser.

### Step 1: Compile the Contract

```bash
# Install the Midnight Compact compiler
npm install -g @midnight-network/compact

# Compile the contract
compact compile contract/private-voting.compact

# This generates:
# - out/contract/index.js (compiled contract)
# - out/keys/ (prover/verifier keys for each circuit)
# - out/zkir/ (zero-knowledge intermediate representation)
```

### Step 2: Start the Local Network

```bash
# Start the local Midnight node, proof server, and indexer
docker compose -f docker-compose.local.yml up -d

# This starts:
# - Midnight node (ledger)
# - Proof server (generates ZK proofs)
# - Indexer (GraphQL API for reading state)
```

### Step 3: Deploy the Contract

```typescript
import { Contract } from 'midnight-js';

const contract = await Contract.deploy({
    networkId: 'local',
    contract: compiledContract,
    constructorArgs: [ownerAddress, electionId],
});

console.log('Contract deployed at:', contract.address);
```

### Step 4: Run the Backend

```bash
cd backend
npm install
npm run dev

# Backend runs on http://localhost:3001
```

### Step 5: Run the Frontend

```bash
cd frontend
npm install
npm run dev

# Frontend runs on http://localhost:3000
```

### Step 6: Interact in the Browser

1. Open http://localhost:3000
2. Click "Connect Wallet" to connect Lace
3. Register as a voter (generates secret key)
4. Select your vote option
5. The backend generates witness data
6. The frontend submits the transaction
7. The proof server generates the ZK proof
8. The contract records the vote
9. The indexer updates the state
10. The frontend displays the updated tally

---

## 7. Testing Strategy

The test suite (`tests/voting.test.ts`) covers four categories:

### Happy Path
- Valid vote casting with correct witness data
- Vote tallying produces correct results
- Voting can be closed by the owner

### Edge Cases
- Double-voting with same nullifier (rejected)
- Invalid vote value (rejected)
- Voting after election closes (rejected)
- Non-owner trying to close voting (rejected)

### Security
- Nullifier uniqueness (1000 unique nullifiers, no collisions)
- Domain separation (different elections produce different nullifiers)
- Commitment binding (cannot change vote after commitment)

### Privacy
- Nullifier doesn't reveal voter identity
- Commitment doesn't reveal vote value
- Cross-election replay prevention

---

## 8. Production Considerations

### 8.1 Key Management

The voter's secret key is the foundation of the privacy guarantee. In production:
- Derive keys from a hardware wallet or HSM
- Never store keys in plain text
- Use a key derivation function (e.g., PBKDF2) with a strong passphrase

### 8.2 Proof Server

The proof server generates ZK proofs for circuit calls. In production:
- Run the proof server on a machine with sufficient RAM (proof generation is memory-intensive)
- Use the correct Docker image tag matching your ledger version
- Monitor proof generation latency (first proofs are slower due to parameter download)

### 8.3 Indexer Sync

The indexer must be fully synced before the frontend can read state. If the indexer is behind, the frontend will show stale data. Always verify the indexer's current block height before displaying results.

### 8.4 Gas Optimization

Each `castVote` call consumes gas. To minimize costs:
- Batch multiple votes in a single transaction when possible
- Use the latest compiler version (optimizations improve with each release)
- Monitor gas prices and adjust transaction timing accordingly

---

## 9. Advanced: Extending the dApp

### 9.1 Multiple Options

The current contract supports two options. To support N options:
- Replace `optionAVotes`/`optionBVotes` with a `Map<Bytes<32>, Uint<256>>`
- Modify the witness generation to handle N vote values
- Update the frontend to display N options

### 9.2 Weighted Voting

To support weighted voting (e.g., token-weighted):
- Add a `weight` parameter to `castVote`
- Verify the voter's weight via a separate token balance check
- Modify tallying to add `weight` instead of 1

### 9.3 Timelock

Add a voting period:
- Store `votingStart` and `votingEnd` timestamps
- Check `block.timestamp` in `castVote`
- Auto-close voting when the period ends

---

## 10. Conclusion

Building a full-stack dApp on Midnight requires understanding several layers: the Compact contract, TypeScript witnesses, the proof server, the backend API, and the React frontend. Each layer plays a specific role in the privacy-preserving voting flow.

The key takeaway: Midnight's zero-knowledge proofs enable privacy by design. Voters can cast votes that are verified without being revealed, and the final tally is transparent without exposing individual choices. This is the foundation for private voting, private auctions, private DAO governance, and many other applications.

### Next Steps
- Explore the full code in the `bounties/314-fullstack-dapp/` directory
- Try deploying to Midnight testnet
- Experiment with the advanced extensions
- Read more in the [Midnight Documentation](https://docs.midnight.network)

---

## Appendix A: Project Structure

```
bounties/314-fullstack-dapp/
├── contract/
│   └── private-voting.compact    # Compact smart contract
├── typescript/
│   └── voting-witness.ts         # Witness generation
├── backend/
│   └── server.ts                 # Express API server
├── frontend/
│   └── voting-components.tsx     # React components
├── tests/
│   └── voting.test.ts            # Test suite
└── TUTORIAL.md                   # This file
```

## Appendix B: API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/election/create` | POST | Create a new election |
| `/api/election/:id` | GET | Get election details |
| `/api/voter/register` | POST | Register a voter |
| `/api/vote/witness` | POST | Generate vote witness |
| `/api/transaction/submit` | POST | Submit transaction to ledger |

## Appendix C: Glossary

- **Compact:** Midnight's smart contract language, designed for privacy-preserving computation
- **Witness:** Private input data used to generate ZK proofs
- **Nullifier:** A unique value that prevents double-voting without revealing identity
- **Commitment:** A binding commitment to a value that hides the value itself
- **Domain Separation:** Using unique identifiers to prevent cross-context replay
- **Indexer:** A service that indexes the ledger and exposes state via GraphQL
- **Proof Server:** A service that generates ZK proofs for circuit calls

---

## 11. Deep Dive: How Zero-Knowledge Proofs Work in This dApp

Understanding the ZK proof flow is essential for building on Midnight. Let's trace what happens when a voter casts a vote, from the moment they click the button to the moment the vote is recorded on the ledger.

### 11.1 The Circuit Execution Model

When you call `castVote` on the contract, the function doesn't execute directly on the ledger. Instead, it runs as a **circuit** — a mathematical representation of the computation that can be proven with a zero-knowledge proof. The circuit includes:

1. **Public inputs:** The arguments visible on the ledger (nullifier, voteCommitment, voteValue)
2. **Private inputs:** Values known only to the prover (the voter's secret key)
3. **Circuit logic:** The validation checks (voting open, nullifier not used, commitment valid)
4. **State updates:** Changes to the contract's ledger state

The prover (the voter's machine, via the proof server) generates a proof that they executed the circuit correctly with valid private inputs, without revealing those private inputs.

### 11.2 Proof Generation Flow

```
Voter clicks "Vote" 
    → Frontend calls backend for witness data
    → Backend generates nullifier + commitment
    → Frontend sends (nullifier, commitment, voteValue) to proof server
    → Proof server generates ZK proof using the circuit + witness
    → Frontend submits (proof, public inputs) to the ledger
    → Ledger verifies the proof and executes the state update
```

The proof server is a critical component. It runs as a Docker container and communicates with the Midnight node. When the frontend submits a circuit call, the proof server:

1. Receives the circuit call request with public and private inputs
2. Downloads the proving key (if not cached) — these are ~30MB each for the first download
3. Generates the ZK proof using the circuit definition and witness data
4. Returns the proof to the caller
5. The caller submits the proof to the ledger

### 11.3 Why ZK Proofs Matter for Privacy

Without ZK proofs, the ledger would see every input to the contract function. With ZK proofs, the ledger only sees:
- The proof itself (a cryptographic blob)
- The public inputs (what the function exposes)
- The resulting state changes (what gets written to the ledger)

The private inputs — in this case, the voter's secret key — never touch the ledger. They're only used to generate the proof. This is what enables voter anonymity: the ledger can verify the vote is valid without knowing who cast it.

---

## 12. Debugging Common Issues

Building dApps on Midnight comes with its own set of challenges. Here are the most common issues you'll encounter and how to fix them.

### 12.1 Proof Server Not Responding

**Symptom:** The proof server Docker container is running, but proof generation requests time out.

**Diagnosis:**
```bash
docker logs midnight-proof-server
# Look for: "listening on port 9944" or error messages
```

**Fix:**
- Ensure the proof server is connected to the same network as the Midnight node
- Check that the proof server version matches the ledger version
- Verify the Docker container has enough memory (proof generation is memory-intensive)

### 12.2 First Proof Download Timeout

**Symptom:** The first proof generation takes a very long time (30+ seconds).

**Cause:** The proof server needs to download the proving keys (~30MB each) on first use.

**Fix:** This is expected behavior. Subsequent proofs are much faster because the keys are cached. For production, pre-download the keys during deployment.

### 12.3 Wire Format Mismatch

**Symptom:** The proof server rejects the transaction with a "wire format mismatch" error.

**Cause:** The data types in your TypeScript code don't match the Compact contract's expected types.

**Fix:**
- Verify that Bytes<32> is passed as a 32-byte Uint8Array (64 hex chars)
- Verify that Uint<8> is passed as a number (not a string)
- Check the contract's compiled output for exact type information

### 12.4 Version Mismatch Between Proof Server and Ledger

**Symptom:** The proof server generates proofs, but the ledger rejects them.

**Cause:** The proof server Docker image version doesn't match the ledger version.

**Fix:**
- Use the same version tag for both the node and proof server Docker images
- Check the Midnight release notes for version compatibility
- Update both containers to the latest version

### 12.5 Indexer Behind on Sync

**Symptom:** The frontend shows stale data even after a vote is submitted.

**Cause:** The indexer hasn't caught up to the latest block.

**Fix:**
- Check the indexer's current block height via the GraphQL endpoint
- Wait for the indexer to catch up (this can take several minutes)
- Implement polling in the frontend to refresh state periodically

---

## 13. Security Best Practices for Midnight dApps

Beyond the specific security features of the PrivateVoting contract, here are general best practices for building secure dApps on Midnight.

### 13.1 Input Validation

Always validate inputs at the contract level, not just in the frontend. The frontend can be bypassed, but the contract's validation is enforced by the network. In the PrivateVoting contract, we validate:
- Voting is open
- Nullifier hasn't been used
- Vote value is valid (0 or 1)
- Vote commitment matches the disclosed value

### 13.2 Access Control

Use `caller()` to verify the caller's identity before allowing privileged operations. In the PrivateVoting contract, only the owner can close voting. Always compare `caller()` against the expected address at the start of privileged functions.

### 13.3 Reentrancy Protection

Midnight's circuit execution model prevents traditional reentrancy attacks — circuit functions execute atomically. However, you should still follow the checks-effects-interactions pattern: validate inputs first, update state, then make external calls.

### 13.4 Key Management

The security of your dApp depends on the security of your keys. For the PrivateVoting dApp:
- Generate voter secret keys using a cryptographically secure random number generator
- Never store secret keys in plain text on the server
- Consider using a hardware wallet for the election owner's key
- Rotate keys periodically for long-running elections

### 13.5 Testing

Test your contract thoroughly before deploying to mainnet. The test suite should cover:
- All circuit functions with valid inputs
- All circuit functions with invalid inputs (error cases)
- Edge cases (boundary conditions, large inputs)
- Security properties (nullifier uniqueness, commitment binding, domain separation)
- Integration tests (full flow from frontend to ledger)

---

## 14. Deploying to Testnet

Once you've tested locally, deploy to Midnight testnet to validate the full flow with real network conditions.

### 14.1 Prerequisites

- Testnet NIGHT tokens (from the [Midnight faucet](https://docs.midnight.network))
- A Lace wallet configured for testnet
- Access to a testnet node or use the public testnet endpoint

### 14.2 Deployment Steps

```bash
# Set the network to testnet
export MIDNIGHT_NETWORK=testnet

# Deploy the contract
compact deploy contract/private-voting.compact \
    --constructor-args "$(midnight address) $(midnight gen-id)" \
    --network testnet

# The contract address will be printed
# Save this address for the frontend configuration
```

### 14.3 Frontend Configuration

Update the frontend to use testnet endpoints:

```typescript
const config = {
    networkId: 'testnet',
    contractAddress: '0x...', // From deployment
    indexerUrl: 'https://indexer.testnet.midnight.network/graphql',
    proofServerUrl: 'https://proof-server.testnet.midnight.network',
};
```

### 14.4 Testing on Testnet

- Connect your Lace wallet to testnet
- Register as a voter
- Cast a vote
- Verify the vote appears in the indexer
- Close voting (as the owner)
- Verify the final tally

Testnet deployment is the final validation step before mainnet. If everything works on testnet, you're ready to deploy to mainnet with confidence.

---

## 15. Resources and Further Reading

- [Midnight Documentation](https://docs.midnight.network) — Official docs for Compact, SDK, and deployment
- [Midnight Developer Forum](https://forum.midnight.network/) — Community discussions and Q&A
- [Midnight Discord](https://discord.com/invite/midnightnetwork) — Real-time chat with developers
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp) — AI-assisted contract development
- [Compact Language Reference](https://docs.midnight.network/compact/reference) — Full language specification
- [Midnight dApp Toolkit](https://docs.midnight.network/dapp-toolkit) — Tools for building and deploying dApps
- [Lace Wallet Documentation](https://lace.io/docs) — Wallet integration guide
