# Midnight Contributor Hub - Bounty Submissions

## Repository Structure

```
bounties/
├── 288-accepting-token-deposits/    # Bounty #288 - $300
│   ├── token-escrow.compact         # Smart contract
│   └── TUTORIAL.md                  # Tutorial (2,000+ words)
└── 327-shielded-token-operations/   # Bounty #327 - $500
    ├── shielded-token.compact       # Smart contract
    ├── test/
    │   ├── shielded-token.test.ts   # Test suite (17 tests)
    │   └── test-utils.ts            # Test utilities
    └── TUTORIAL.md                  # Tutorial (3,000+ words)
```

## Prerequisites

- **Node.js**: >= 20.0.0
- **Midnight CLI**: @midnight-labs/cli@latest
- **Compact Compiler**: >= 0.16.0

## Compilation

### Bounty #288 - Token Escrow

```bash
# Navigate to the bounty directory
cd bounties/288-accepting-token-deposits

# Compile the contract
midnight compile token-escrow.compact

# Expected output:
# ✅ Compilation successful
# Output: managed/token-escrow/contract.ts
```

### Bounty #327 - Shielded Token

```bash
# Navigate to the bounty directory
cd bounties/327-shielded-token-operations

# Compile the contract
midnight compile shielded-token.compact

# Expected output:
# ✅ Compilation successful
# Output: managed/shielded-token/contract.ts
```

## Testing

### Bounty #327 Test Suite

```bash
cd bounties/327-shielded-token-operations

# Install dependencies
npm install

# Run tests
npm test

# Expected output:
# ✅ 17 tests passing
# - mintShieldedToken: 4 tests
# - sendShielded: 3 tests
# - sendImmediateShielded: 2 tests
# - shieldedBurn: 2 tests
# - mint_and_send: 3 tests
# - evolveNonce: 2 tests
# - ShieldedSendResult: 1 test
```

## Environment Setup

```bash
# Set up Midnight network connection
export MIDNIGHT_NETWORK=testnet
export MIDNIGHT_RPC_URL=https://testnet-rpc.midnight.network

# Verify connection
midnight network status
# Expected: Connected to testnet
```

## Troubleshooting

### Compilation Errors

**Error**: `Type mismatch: expected Bytes<32>, got Uint<64>`
**Fix**: Use `pad(32, value)` to convert types before calling `evolveNonce`.

**Error**: `Cannot find module './managed/...'`
**Fix**: Run `midnight compile` first to generate the managed directory.

### Test Failures

**Error**: `Cannot find module './test-utils'`
**Fix**: Ensure `test-utils.ts` is in the `test/` directory.

## License

Apache-2.0 - See LICENSE file for details.
