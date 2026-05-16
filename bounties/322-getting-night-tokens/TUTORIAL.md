---
title: "Getting NIGHT Tokens: Exchanges, Bridging & Wallet Funding on Midnight Mainnet"
---

# Getting NIGHT Tokens: Exchanges, Bridging & Wallet Funding on Midnight Mainnet

Getting started on any blockchain begins with the same hurdle: acquiring the native token. For Midnight — the privacy-first blockchain platform built on Cardano — that token is **NIGHT**. In this tutorial, we'll walk through every method of obtaining NIGHT tokens, setting up your wallet, bridging from other chains, and funding your wallet for your first dApp interaction on mainnet.

## What is NIGHT?

NIGHT is the native utility token of the Midnight network. It serves three primary purposes:

1. **Transaction fees** — Every proof generation, contract deployment, and state update requires NIGHT
2. **Staking** — Node operators stake NIGHT to participate in consensus
3. **Governance** — NIGHT holders participate in protocol parameter decisions

Unlike fully shielded tokens, NIGHT can exist in both transparent (UTXO) and shielded forms, giving developers and users flexibility in how they handle privacy.

## Method 1: Acquiring NIGHT via Centralized Exchanges

### Supported Exchanges

As of May 2026, NIGHT is listed on several centralized exchanges:

1. **Gate.io** — The first major exchange to list NIGHT/NIGHT-ADA trading pairs. Offers both spot and limit orders.
2. **MEXC** — Lists NIGHT with USDT and ADA pairs. Supports limit, market, and OCO orders.
3. **KuCoin** — NIGHT/USDT pair available for spot trading.

### Step-by-Step: Buying on Gate.io

1. Create and verify your Gate.io account (KYC required)
2. Deposit USDT or ADA via the deposit page
3. Navigate to Trade > Spot
4. Search for NIGHT/USDT or NIGHT/ADA
5. Place a limit or market order
6. Your NIGHT tokens will appear in your Spot wallet

**Important:** When purchasing NIGHT for use on Midnight mainnet, you'll eventually need to withdraw to a compatible wallet (Lace or 1AM) — not to an exchange deposit address.

## Method 2: Bridging ADA to Midnight

If you hold ADA (Cardano's native token) and want to convert to NIGHT for mainnet use, bridging is the most direct path.

### Prerequisites

- A Cardano wallet with ADA (Eternl, Nami, or Lace)
- A Midnight-compatible wallet (Lace with Midnight support, or 1AM wallet)
- Access to the Midnight bridge interface

### The Bridge Process

Cardano (ADA) --[Bridge]--> Midnight (NIGHT)
  Eternl/Nami              Lace/1AM Wallet

**Step 1:** Connect your Cardano wallet to the Midnight bridge.

**Step 2:** Select the amount of ADA to bridge. The bridge will show the equivalent NIGHT amount based on the current rate.

**Step 3:** Approve the transaction on your Cardano wallet. This burns ADA on Cardano and mints NIGHT on Midnight.

**Step 4:** Wait for the bridge finality. Bridge transactions typically take 5-15 minutes to confirm across both chains.

**Step 5:** Verify the NIGHT balance in your Midnight wallet.

```bash
# Using the Midnight CLI to verify your balance:
midnight-cli balance --wallet my-wallet --network mainnet
```

## Method 3: The Glacier Drop Program

The **Midnight Glacier Drop** (https://www.midnight.gd/) is a token distribution program that airdrops NIGHT tokens to eligible Cardano ADA holders.

### Eligibility Requirements

- Held ADA in a self-custodied wallet before the snapshot date
- Completed KYC through SumSub verification
- Connected a compatible wallet

### Claiming Your Drop

1. Visit [midnight.gd](https://www.midnight.gd/)
2. Connect your eligible Cardano wallet
3. Complete SumSub KYC if not already done
4. Claim your allocated NIGHT tokens
5. Tokens are deposited directly into your connected wallet

The Glacier Drop is currently the largest distribution channel for NIGHT tokens and requires no purchase — just eligibility verification.

## Setting Up Your Midnight Wallet

### Option A: Lace Wallet (Recommended)

Lace is the official Cardano/Midnight wallet developed by IOG.

1. **Install:** Download from lace.io or install as a Chrome/Firefox extension
2. **Create or Restore:** Either create a new wallet or import an existing Cardano seed phrase
3. **Enable Midnight:** In Lace settings, toggle "Midnight support" to access the Midnight network
4. **Network Selection:** Switch between Cardano and Midnight using the network dropdown

### Option B: 1AM Wallet

1AM is a community-developed wallet with full Midnight dApp connector support.

1. Install from the Chrome Web Store
2. Create a new wallet
3. Connect to Midnight mainnet
4. Use the dApp connector for developer workflows

### Wallet Security Best Practices

- **Never share your seed phrase.** Store it offline, in multiple secure locations.
- **Use a hardware wallet** if available for mainnet operations.
- **Test with small amounts first** before conducting large transactions.
- **Verify contract addresses** before interacting with any dApp.

## Funding Your Wallet for dApp Development

Once you have NIGHT in your wallet, here's what you need to get started building:

### Minimum Balance Requirements

| Activity | Estimated NIGHT Cost |
|----------|---------------------|
| Contract deployment | 10-50 NIGHT |
| Proof generation (per proof) | 0.1-2 NIGHT |
| Wallet-to-wallet transfer | 0.01-0.1 NIGHT |
| dApp interaction (read state) | 0.001-0.01 NIGHT |

For a typical development session, we recommend starting with **at least 50 NIGHT** to cover multiple deployments and proof generations.

### First Transaction: Verifying Your Setup

After funding your wallet, verify everything is working:

```bash
# 1. Check your wallet balance
midnight-cli balance --wallet my-wallet --network mainnet

# 2. Send a test transaction (0.1 NIGHT to your own address)
midnight-cli send --wallet my-wallet --to <your-address> --amount 0.1 --network mainnet

# 3. Verify the transaction appears on-chain
midnight-cli tx-status <tx-hash> --network mainnet
```

### Troubleshooting Common Issues

**"Insufficient funds" error:** Make sure your wallet balance covers both the transaction amount AND the fee. Midnight fees are dynamic based on network load.

**Transaction stuck in mempool:** Check the network status. During high-traffic periods, transactions may take longer to confirm. You can increase the fee to prioritize.

**Wallet not showing balance:** Ensure you're connected to the correct network (mainnet vs. devnet). Switch in your wallet settings.

**Bridge transfer delayed:** Bridge transfers can take 5-15 minutes. If it exceeds 30 minutes, check the bridge explorer for the transaction status.

## From Funding to Building

With NIGHT in your wallet, you're ready to deploy your first Midnight dApp. The next steps in your development journey:

1. Install the Midnight toolchain (`midnight-cli install`)
2. Create your first Compact contract (`midnight-cli init my-dapp`)
3. Deploy to mainnet (`midnight-cli deploy --network mainnet`)
4. Interact via the dApp connector

## Summary

| Method | Best For | Time Required | KYC Required |
|--------|----------|---------------|--------------|
| CEX (Gate.io, MEXC) | Quick purchase | 10-30 min | Yes |
| ADA Bridge | Cardano holders | 5-15 min | No |
| Glacier Drop | Eligible ADA holders | 15-30 min | Yes (SumSub) |

No matter which method you choose, the key steps remain the same: **acquire NIGHT → fund your wallet → verify balance → start building**. The Midnight ecosystem is designed to make this flow as frictionless as possible while maintaining the privacy guarantees that define the platform.
