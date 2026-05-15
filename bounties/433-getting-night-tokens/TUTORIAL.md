# Getting NIGHT Tokens Tutorial

## Your Complete Guide to Acquiring NIGHT Tokens for Midnight Network Development

So you want to get your hands on some NIGHT tokens? Maybe you're about to dive into Midnight Network development, claim a bounty, or just explore what the ecosystem has to offer. Whatever your reason, I'll walk you through every option available to get NIGHT tokens into your wallet.

I remember spending an afternoon going in circles trying to figure out the easiest path to get tokens. This guide is what I wish I'd had from the start.

---

## Prerequisites: Setting Up Your Wallet

Before you can receive NIGHT tokens, you need a compatible wallet. Midnight Network uses a UTXO model with shielded transactions, so your wallet needs to handle that.

### Option 1: Midnight Wallet (Recommended)

The official Midnight Wallet is the best choice for most users:

1. **Download** from the [Midnight Network official site](https://www.midnight.network/wallet)
2. **Install** the browser extension (Chrome, Firefox, or Brave)
3. **Create a new wallet** or **import an existing seed phrase**
4. **Save your recovery phrase** — store it securely offline

The wallet extension provides:
- Shielded address generation (for private transactions)
- Balance viewing for NIGHT and other tokens
- Transaction history
- Connection to dApps via WalletConnect

### Option 2: Ledger Hardware Wallet

For maximum security, Midnight supports Ledger devices:

1. **Update your Ledger firmware** to the latest version
2. **Install the Midnight app** from Ledger Live
3. **Connect your Ledger** to the Midnight Wallet browser extension
4. **Approve transactions** physically on your device

### Finding Your Midnight Address

Once your wallet is set up, here's how to find your address:

1. Open the Midnight Wallet extension
2. Click on your account
3. Look for the **shielded address** (starts with `ms` for Midnight Shielded)
4. Copy it — this is what you'll share to receive tokens

```
Example: ms1qxyz...abc123
```

**Important:** Midnight has both transparent and shielded addresses. For privacy, use the shielded address (`ms1...`). Transparent addresses start with `tms` for testnet or `ms` for mainnet.

---

## Method 1: Cryptocurrency Exchanges

### Centralized Exchanges (CEX)

Several exchanges list NIGHT. The easiest method if you're buying directly:

| Exchange | Trading Pairs | Fiat Support |
|----------|-------------|--------------|
| Bitfinex | NIGHT/USDT, NIGHT/BTC | Yes |
|MEXC | NIGHT/USDT | Limited |
| Gate.io | NIGHT/USDT, NIGHT/ETH | Yes |

**Steps to buy on an exchange:**

1. **Create an account** on a supported exchange
2. **Complete KYC verification** (required for most exchanges)
3. **Deposit funds** via bank transfer, credit card, or crypto transfer
4. **Buy NIGHT** using USDT or another supported trading pair
5. **Withdraw to your wallet** — use your Midnight shielded address

**Withdrawal settings:**
- Network: Select **Midnight Network** (not Ethereum, not any other chain)
- Address: Paste your `ms1...` address
- Double-check the network — cross-chain mistakes mean permanent loss

### Decentralized Exchanges (DEX)

If you prefer non-custodial trading:

1. **Connect your Midnight Wallet** to a DEX on Midnight Network
2. **Swap ETH or other tokens** for NIGHT
3. **Tokens go directly to your wallet**

Popular DEX options include:
- MidnightSwap (if available)
- Any Midnight-native AMM

---

## Method 2: Bridges

If you already hold tokens on another blockchain, bridges let you move them to Midnight Network.

### Supported Bridges

**LayerZero Bridge**
- Connect: Ethereum, Arbitrum, Optimism, Base
- Best for: Multi-chain users

**Stargate**
- Connect: Ethereum, BNB Chain, Avalanche
- Best for: Stablecoin transfers

**Celer cBridge**
- Connect: Ethereum, Polygon, Gnosis Chain
- Best for: Fast, low-cost transfers

### Bridge Process

1. **Connect your wallet** to the bridge interface
2. **Select source chain** (where your tokens are)
3. **Select destination chain** → Midnight Network
4. **Choose token** to bridge
5. **Initiate transfer** and approve transactions on both chains
6. **Wait for confirmation** — bridges typically take 5-30 minutes

**Bridge fees:** Expect to pay:
- Source chain gas fees
- Bridge protocol fee (usually 0.1-0.5%)
- Destination chain gas (for claiming tokens)

---

## Method 3: Testnet Faucets

For development and testing, Midnight provides testnet NIGHT tokens. These have no real value but work identically to mainnet tokens.

### Midnight Testnet Faucet

1. **Visit** the [Midnight faucet](https://faucet.midnight.network)
2. **Connect** your wallet (use testnet mode)
3. **Request test tokens** — typically 1000 test NIGHT per request
4. **Wait** a few seconds for confirmation

**Faucet limits:** Most faucets limit requests to prevent abuse. If you hit a limit, wait 24 hours or check Discord for community faucets.

### Community Faucets

The Midnight Discord sometimes runs community faucets during events:
- Join the [Midnight Discord server](https://discord.gg/midnight)
- Check the `#testnet-faucet` channel
- Follow bot instructions to claim tokens

---

## Method 4: Development Rewards & Bounties

One of the best ways to earn NIGHT is by contributing to the ecosystem.

### Bounty Program

Midnight Network offers bounties for:
- **Content creation** (tutorials, documentation)
- **Bug bounties** (security vulnerabilities)
- **dApp development** (building on Midnight)
- **Community contributions** (translations, support)

**Bounty process:**
1. Browse [open bounties](https://github.com/midnightntwrk/contributor-hub/issues)
2. Pick one that matches your skills
3. Complete the work
4. Submit via PR or as directed in the bounty
5. Complete KYC via SumSub
6. Receive NIGHT tokens to your wallet

**Bounty terms:**
- All participants must complete KYC before receiving tokens
- Rewards specified per bounty are non-negotiable
- Payments distributed after work is approved

### Developer Grants

For larger projects, Midnight Foundation offers grants:
- Applications via the [Midnight website](https://www.midnight.foundation/grants)
- Typical amounts: $5,000 - $100,000+ in NIGHT
- Longer application process, but substantial rewards

---

## Method 5: Peer-to-Peer Transfers

If you know someone who already has NIGHT, they can send directly to your address:

1. **Share your Midnight shielded address** (`ms1...`)
2. **They initiate a transfer** from their wallet
3. **Transaction confirms** — typically under a minute on mainnet

This is the fastest method if you have a contact with tokens.

---

## Checking Your NIGHT Balance

### In Your Wallet

1. Open the Midnight Wallet extension
2. Your NIGHT balance appears on the main screen
3. Click on NIGHT to see transaction history and token details

### On Block Explorers

For a detailed view:

1. Visit the [Midnight block explorer](https://explorer.midnight.network)
2. Enter your address in the search bar
3. View:
   - Current balance
   - Transaction history
   - All token holdings
   - Shielded transaction details

### Via Command Line (Advanced)

For developers:

```bash
# Install Midnight CLI
npm install -g @midnighthq/cli

# Check balance
midnight balance --address ms1qxyz...abc123

# Check specific token
midnight balance --address ms1qxyz...abc123 --token NIGHT
```

---

## Important Considerations

### Transaction Fees

Every transaction on Midnight Network requires a small fee in NIGHT:
- Simple transfers: ~0.001 NIGHT
- Smart contract interactions: Variable (complexity-based)
- Keep a small balance (10-50 NIGHT) for fees

### Network Selection

**Testnet vs Mainnet:**
- **Testnet tokens** are free but have no real value
- **Mainnet tokens** are real — double-check every transaction
- Never send mainnet tokens to testnet addresses or vice versa

### Privacy Features

Midnight's shielded transactions hide:
- Transaction amounts
- Sender and receiver addresses
- Transaction history (to outside observers)

**However:**
- You can still see your own transaction history
- Counterparties who you're transacting with may know your address
- Compliance requests may require disclosure

### Cross-Chain Mistakes

The #1 cause of lost tokens is sending to the wrong network. Always verify:
- Source chain matches where tokens are being sent from
- Destination chain is set to Midnight Network
- Address format is correct for Midnight (`ms1...` for shielded)
- Double-check before confirming any bridge or swap transaction

---

## Troubleshooting

### My tokens didn't arrive after a bridge

1. Check the source chain explorer for the transaction
2. Check the Midnight block explorer for the destination transaction
3. Wait longer — bridges can take up to 30 minutes
4. Check the bridge's support or Discord for pending claims
5. If stuck, open a support ticket with your transaction hash

### My balance shows 0 but I know I have tokens

1. Make sure you're on the correct network (mainnet vs testnet)
2. Refresh the wallet or reconnect
3. Try importing the seed phrase into a different wallet
4. Check the block explorer directly

### Transaction stuck pending

1. Check network congestion on the Midnight block explorer
2. Increase gas fee if your wallet allows
3. Wait — Midnight typically confirms within minutes
4. If stuck for hours, check wallet support forums

---

## Quick Reference: Getting Started Checklist

- [ ] Download and set up Midnight Wallet
- [ ] Write down and secure your recovery phrase
- [ ] Get your Midnight shielded address (`ms1...`)
- [ ] For development: Set wallet to testnet mode and use faucet
- [ ] For real tokens: Use exchange, bridge, or P2P transfer
- [ ] Keep 10-50 NIGHT for transaction fees
- [ ] Verify balance on block explorer
- [ ] For bounties: Complete KYC before claiming rewards

---

## Resources

- [Midnight Network Official Site](https://www.midnight.network)
- [Midnight Documentation](https://docs.midnight.network)
- [Midnight Wallet Download](https://www.midnight.network/wallet)
- [Midnight Discord](https://discord.gg/midnight)
- [Midnight Block Explorer](https://explorer.midnight.network)
- [Contributor Hub (Bounties)](https://github.com/midnightntwrk/contributor-hub)
- [Bounty Program Terms](https://github.com/midnightntwrk/contributor-hub/blob/main/legal/BOUNTY_TERMS.md)

---

*This tutorial is for educational purposes. Token availability, exchange listings, and bridge support may change. Always verify current information on official Midnight Network channels.*
