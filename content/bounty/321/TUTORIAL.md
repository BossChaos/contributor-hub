# Handling Midnight SDK Breaking Changes: A Developer's Upgrade Playbook

Midnight moves fast. In the last six months alone, the JavaScript SDK has jumped from v3.0.0-alpha.9 to v4.0.4, and with each release developers face a familiar problem: code that worked yesterday no longer compiles today.

This tutorial isn't about one specific version bump. It's a **repeatable process** for upgrading your Midnight dApps when breaking changes land — covering how to identify what changed, migrate your code systematically, and keep your project healthy across major releases.

---

## Why Midnight Upgrades Break Things (And Why That's Good)

Midnight is a privacy-first smart contract platform built on zero-knowledge cryptography. Its stack is young and actively evolving:

- The **Compact language** (Midnight's smart contract language) gets new primitives and syntax changes regularly.
- The **JavaScript SDK** (`midnight-js` and related packages) wraps Compact, handles wallet connections, manages private state, and builds transactions.
- **Supporting infrastructure** — proof servers, indexers, nodes — also updates frequently.

Breaking changes are a feature, not a bug. They mean the platform is maturing. A v4.0.0 release that removes deprecated APIs or restructures how proofs are submitted is a sign that Midnight is moving toward production readiness.

The real problem isn't that breaking changes exist. It's that many developers treat upgrades as "fix the errors until it compiles" rather than following a structured migration process. That approach works for one or two files but falls apart for a real dApp with contracts, TypeScript witnesses, a frontend, and tests.

Below is the process I've refined through multiple upgrade cycles — from v3.0.0 through v4.0.4.

---

## Phase 1: Identify What Changed Before You Touch Code

### 1.1 Read the CHANGELOG (But Read It Smartly)

The `midnight-js` CHANGELOG is the single best resource for understanding what changed. But reading every commit is impractical. Instead, focus on three sections:

```bash
# Get the diff between your current version and the target
curl -s https://raw.githubusercontent.com/midnightntwrk/midnight-js/main/CHANGELOG.md \
  | grep -A 200 "## \[v4\.0\.0\]" | head -100
```

**What to look for:**

| Section | What It Means |
|---------|--------------|
| `### Features` | New APIs — usually backward compatible |
| `### Code Refactoring` | **Breaking changes** — APIs renamed, removed, or restructured |
| `### Bug Fixes` | Behavior corrections that may break assumptions |
| `### Improvements` | Dependency bumps, config changes — usually safe |

From the v3.2.0 to v4.0.0 changelog, here are the breaking changes that actually matter:

1. **`remove walletProvider option`** (PR #528) — LevelDB provider now requires `privateStoragePasswordProvider` instead of `walletProvider`.
2. **`remove newCoins parameter from balanceTx`** (PR #466) — Transaction balancing API signature changed.
3. **`remove signTx method`** (PR #466) — `midnight-wallet-provider` no longer has `signTx`; balancing transactions now sign automatically.
4. **`LedgerParameters flow change`** (PR #633) — Ledger v8 changes how parameters are passed.
5. **`createUnprovenLedgerCallTx reverted`** (PR #695) — The API was changed and then reverted to `ContractCallPrototype` approach.
6. **`compact → compactc rename`** (PR #580) — CLI tool renamed from `compact` to `compactc`.
7. **`@midnight-ntwrk/midnight-js barrel package`** (PR #735, v4.0.3) — New unified import path available.

### 1.2 Check GitHub Issues for Migration Guides

The Midnight team often publishes migration notes in GitHub issues or release discussions:

```bash
# Search for migration-related issues
gh issue list --repo midnightntwrk/midnight-js --state all \
  --search "migration breaking upgrade" --limit 10
```

### 1.3 Run the Dependency Checker

Before upgrading, audit your current dependencies:

```bash
# Check what Midnight packages you're using
cat package.json | grep -E "midnight|compact" | sort
```

A typical v3.x dApp might have:

```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js-types": "^3.2.0",
    "@midnight-ntwrk/midnight-js-tx-builder": "^3.2.0",
    "@midnight-ntwrk/midnight-js-wallet-provider": "^3.2.0",
    "@midnight-ntwrk/midnight-js-level-private-state-provider": "^3.2.0",
    "@midnight-ntwrk/compact-runtime": "^0.14.0"
  }
}
```

In v4.x, many of these are consolidated into the barrel package `@midnight-ntwrk/midnight-js`.

---

## Phase 2: The Systematic Upgrade Process

### 2.1 Create a Migration Branch

```bash
git checkout -b chore/upgrade-midnight-sdk-v4
```

Never upgrade on main. You'll need to commit migration work incrementally as you fix each breaking change.

### 2.2 Update Dependencies

```bash
# Update to latest stable
npm install @midnight-ntwrk/midnight-js@latest
npm install @midnight-ntwrk/compact-runtime@latest

# Or if you're still on individual packages, consolidate:
npm install @midnight-ntwrk/midnight-js@latest
# Then remove old individual packages one at a time, verifying compilation after each removal
```

### 2.3 Run TypeScript Compiler (Don't Fix Yet)

```bash
npx tsc --noEmit 2>&1 | tee upgrade-errors.log
wc -l upgrade-errors.log
```

This gives you a complete error inventory. The number tells you the scope of the migration. Don't start fixing individual errors yet — categorize them first.

### 2.4 Categorize Errors by Breaking Change Type

Most breaking changes fall into these categories:

```bash
# Pattern: API method removed or renamed
grep "does not exist on type" upgrade-errors.log | sort | uniq -c | sort -rn

# Pattern: Import path changed
grep "Cannot find module" upgrade-errors.log | sort | uniq -c | sort -rn

# Pattern: Function signature changed (argument count/type mismatch)
grep "Expected.*arguments" upgrade-errors.log | sort | uniq -c | sort -rn
```

---

## Phase 3: Migration Patterns for Common Breaking Changes

Here are the five most common breaking changes I've encountered, with before/after examples.

### Pattern 1: Package Consolidation (v4.0.3+)

**Before (v3.x — scattered imports):**

```typescript
import { MidnightWalletProvider } from "@midnight-ntwrk/midnight-js-wallet-provider";
import { TxBuilder } from "@midnight-ntwrk/midnight-js-tx-builder";
import { createLevelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { compileContract } from "@midnight-ntwrk/midnight-js-compact";
import type { CompiledContract } from "@midnight-ntwrk/midnight-js-types";
```

**After (v4.0.3+ — barrel package):**

```typescript
import { 
  MidnightWalletProvider, 
  TxBuilder, 
  createLevelPrivateStateProvider,
  compileContract 
} from "@midnight-ntwrk/midnight-js";
import type { CompiledContract } from "@midnight-ntwrk/midnight-js";
```

The barrel package (`@midnight-ntwrk/midnight-js`) re-exports everything from the individual sub-packages. This is the recommended import path going forward.

### Pattern 2: Wallet Provider Configuration Change (v3.2.0)

**The change:** PR #528 removed the `walletProvider` option from `LevelPrivateStateProvider` and now requires `privateStoragePasswordProvider`.

**Before (v3.x):**

```typescript
import { LevelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";

const stateProvider = new LevelPrivateStateProvider({
  walletProvider: myWalletProvider,  // ← REMOVED
  dbPath: "./private-state",
});
```

**After (v4.x):**

```typescript
import { createLevelPrivateStateProvider } from "@midnight-ntwrk/midnight-js";

const stateProvider = createLevelPrivateStateProvider({
  privateStoragePasswordProvider: async () => {
    // Return a password for encrypting private state
    // This can come from a secure prompt, environment variable, or key management service
    return process.env.PRIVATE_STATE_PASSWORD || "secure-password-here";
  },
  dbPath: "./private-state",
});
```

**Migration tip:** If your dApp previously used the wallet to derive encryption keys, you'll need to implement a password management strategy. For development, an environment variable works. For production, integrate with a secure key vault.

### Pattern 3: Transaction Balancing API Change (v4.0.0)

**The change:** PR #466 removed the `newCoins` parameter from `balanceTx` and removed `signTx` entirely — balancing now handles signing automatically.

**Before (v3.x):**

```typescript
import { balanceTx, signTx } from "@midnight-ntwrk/midnight-js-tx-builder";

// Step 1: Build the transaction
const tx = await txBuilder.build();

// Step 2: Balance with explicit newCoins parameter
const balanced = await balanceTx(tx, {
  newCoins: await walletProvider.getCoins(),  // ← REMOVED
});

// Step 3: Sign separately
const signed = await signTx(balanced, walletProvider);  // ← REMOVED

// Step 4: Submit
await submitTx(signed);
```

**After (v4.x):**

```typescript
import { TxBuilder } from "@midnight-ntwrk/midnight-js";

const txBuilder = new TxBuilder();
// ... add your transaction operations ...

// Balance and sign in one step — no newCoins, no separate signTx
const balancedAndSigned = await txBuilder.balanceAndSign({
  walletProvider: myWalletProvider,
});

// Submit
await txBuilder.submit(balancedAndSigned);
```

**Why this matters:** The old API leaked implementation details. Developers shouldn't need to manually source coins for balancing or manage the signing step separately. The new API treats balance-and-sign as a single atomic operation.

### Pattern 4: CLI Tool Rename (v3.2.0)

**The change:** The `compact` CLI was renamed to `compactc` for clarity.

**Before (v3.x):**

```bash
compact compile ./contracts/MyContract.compact
compact test ./contracts/MyContract.compact
```

**After (v4.x):**

```bash
compactc compile ./contracts/MyContract.compact
compactc test ./contracts/MyContract.compact
```

**Migration tip:** Update all scripts, Makefiles, CI pipelines, and documentation references. A quick search catches most of these:

```bash
grep -r "compact " ./scripts ./Makefile ./package.json ./docs \
  | grep -v "compactc" | grep -v node_modules
```

### Pattern 5: Compact Language Version Pragma

As the Compact compiler evolves, contract files may need their pragma updated:

**Before:**

```compact
language_version >= 0.22
```

**After:**

```compact
language_version >= 0.30
```

Check the compiler version you're using and update the pragma accordingly:

```bash
compactc --version
# Update the pragma to match or exceed the minimum version
```

---

## Phase 4: Testing Your Migration

### 4.1 Compile All Contracts

```bash
# Compile every contract in your project
for f in contracts/*.compact; do
  echo "Compiling $f..."
  compactc compile "$f" || echo "FAILED: $f"
done
```

If any contract fails to compile, the issue is either:
1. A Compact language syntax change (check release notes for language changes)
2. A missing standard library import (stdlib paths may have changed)
3. An incompatible `language_version` pragma

### 4.2 Run the TypeScript Test Suite

```bash
npm test 2>&1 | tee test-results.log
```

Focus on three types of test failures:

| Failure Type | Likely Cause | Fix |
|-------------|-------------|-----|
| `TypeError: X is not a function` | API removed or renamed | Update to new API pattern |
| `Cannot read properties of undefined` | Response shape changed | Update destructuring/access pattern |
| `Proof generation failed` | Proof server API changed | Check proof provider configuration |

### 4.3 Test Wallet Integration

```typescript
// Quick smoke test for wallet connection
async function testWalletConnection() {
  const wallet = await MidnightWalletProvider.create({
    networkId: "mainnet",
    privateStoragePasswordProvider: async () => process.env.WALLET_PASSWORD,
  });
  
  const address = await wallet.getAddress();
  console.log("Wallet connected:", address);
  
  const balance = await wallet.getBalance();
  console.log("Balance:", balance);
}
```

---

## Phase 5: Preventing Future Upgrade Pain

### 5.1 Pin Dependencies, But Not Too Tightly

```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js": "~4.0.0"
  }
}
```

Use `~` (tilde) to allow patch updates but block major version jumps. This gives you security fixes without surprise breaking changes.

### 5.2 Watch GitHub Releases

Set up notifications for the `midnight-js` repository:

```bash
# Using GitHub CLI to watch
gh repo watch midnightntwrk/midnight-js
```

Or add an RSS feed check to your CI:

```yaml
# .github/workflows/check-midnight-updates.yml
name: Check Midnight SDK Updates
on:
  schedule:
    - cron: "0 9 * * 1"  # Every Monday at 9 AM
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: |
          LATEST=$(curl -s https://api.github.com/repos/midnightntwrk/midnight-js/releases/latest | jq -r .tag_name)
          CURRENT=$(node -p "require('./package.json').dependencies['@midnight-ntwrk/midnight-js']")
          echo "Latest: $LATEST, Current: $CURRENT"
          if [ "$LATEST" != "$CURRENT" ]; then
            echo "::warning::New Midnight SDK version available: $LATEST"
          fi
```

### 5.3 Write Adapter Layers

Instead of importing Midnight APIs directly throughout your codebase, create a thin adapter module:

```typescript
// src/adapters/midnight.ts
import { TxBuilder, MidnightWalletProvider } from "@midnight-ntwrk/midnight-js";

// Your app imports from here, not from Midnight directly
export async function createAndSubmitTransaction(
  wallet: MidnightWalletProvider,
  operations: TransactionOperation[]
): Promise<TxResult> {
  const builder = new TxBuilder();
  for (const op of operations) {
    builder.addOperation(op);
  }
  return builder.balanceAndSign({ walletProvider: wallet });
}
```

When a breaking change lands, you update one file instead of fifty.

### 5.4 Maintain a Version Compatibility Matrix

Keep a simple table in your README:

| Your dApp Version | Midnight SDK | Compact Compiler | Node/Proof Server |
|-------------------|-------------|-------------------|-------------------|
| v1.0.0 | ~3.2.0 | 0.22.x | alpha.19 |
| v1.1.0 | ~4.0.0 | 0.30.x | 0.18.0-rc.10 |
| v1.2.0 (current) | ~4.0.4 | 0.30.x | latest |

---

## Real-World Example: Upgrading a Token dApp from v3.2.0 to v4.0.4

Let's walk through an actual upgrade of a shielded token dApp.

### Step 1: The Starting Point (v3.2.0)

```typescript
// wallet.ts — v3.2.0 version
import { MidnightWalletProvider } from "@midnight-ntwrk/midnight-js-wallet-provider";
import { LevelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";

const stateProvider = new LevelPrivateStateProvider({
  walletProvider: walletProvider,
  dbPath: "./token-dapp-state",
});

const wallet = new MidnightWalletProvider({
  stateProvider,
  networkId: "testnet",
});
```

### Step 2: Apply Migration Patterns

```typescript
// wallet.ts — v4.0.4 version
import { 
  MidnightWalletProvider, 
  createLevelPrivateStateProvider 
} from "@midnight-ntwrk/midnight-js";

// Migration 1: Use createLevelPrivateStateProvider instead of constructor
const stateProvider = createLevelPrivateStateProvider({
  privateStoragePasswordProvider: async () => 
    process.env.TOKEN_DAPP_PASSWORD || "change-me-in-production",
  dbPath: "./token-dapp-state",
});

// Migration 2: Wallet provider initialization may have changed
const wallet = new MidnightWalletProvider({
  networkId: "testnet",
});
wallet.addStateProvider(stateProvider);
```

### Step 3: Update Transaction Building

```typescript
// token-operations.ts — v3.2.0
import { balanceTx, signTx } from "@midnight-ntwrk/midnight-js-tx-builder";

async function mintTokens(amount: bigint) {
  const tx = await txBuilder.mint(amount).build();
  const balanced = await balanceTx(tx, { newCoins: [] });
  const signed = await signTx(balanced, wallet);
  return submitTx(signed);
}
```

```typescript
// token-operations.ts — v4.0.4
import { TxBuilder } from "@midnight-ntwrk/midnight-js";

async function mintTokens(amount: bigint) {
  const txBuilder = new TxBuilder();
  txBuilder.mint(amount);
  const result = await txBuilder.balanceAndSign({ 
    walletProvider: wallet 
  });
  return txBuilder.submit(result);
}
```

### Step 4: Update Build Scripts

```diff
# Makefile
- compact compile contracts/TokenContract.compact
+ compactc compile contracts/TokenContract.compact
```

```diff
# contracts/TokenContract.compact
- language_version >= 0.22
+ language_version >= 0.30
```

### Step 5: Verify

```bash
# Compile
compactc compile contracts/TokenContract.compact

# Test
npm test

# Integration smoke test
node scripts/smoke-test.mjs
```

---

## Troubleshooting Common Post-Upgrade Issues

### Issue: "Proof server not responding"

**Cause:** v4.0.x changed how proof providers connect. The `httpClientProofProvider` now requires explicit headers handling (PR #685).

**Fix:**

```typescript
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js";

const proofProvider = httpClientProofProvider({
  url: "http://localhost:9999",
  headers: {
    // Add any required auth headers
    "Authorization": `Bearer ${process.env.PROOF_SERVER_TOKEN}`,
  },
});
```

### Issue: "CompactError: Version mismatch"

**Cause:** Your contract's `language_version` pragma doesn't match the compiler version.

**Fix:**

```bash
# Check compiler version
compactc --version
# Output: 0.30.0

# Update contract pragma
# language_version >= 0.30
```

### Issue: "TransactionContext not found in circuit call arguments"

**Cause:** PR #689 and related fixes changed how `QueryContext` and `TransactionContext` are handled. The binary path is now lossless (no more data corruption in context passing).

**Fix:** Ensure your witness generation functions don't manually serialize `TransactionContext` — let the SDK handle it.

```typescript
// DON'T do this:
const args = {
  ...myWitness,
  transactionContext: serialize(ctx),  // Wrong in v4.x
};

// DO this:
const args = {
  ...myWitness,
  // TransactionContext is handled by the SDK
};
```

### Issue: "crypto.timingSafeEqual is not available"

**Cause:** Browser builds don't always expose `crypto.timingSafeEqual`. Fixed in PR #737 for v4.0.4.

**Fix:** Upgrade to v4.0.4+ or add a polyfill in your browser build configuration.

---

## The Upgrade Checklist

Before declaring an upgrade complete, verify each item:

- [ ] `package.json` updated to new SDK version
- [ ] All `compact` CLI references changed to `compactc`
- [ ] All contract `language_version` pragmas updated
- [ ] All contracts compile with `compactc compile`
- [ ] `walletProvider` → `privateStoragePasswordProvider` migration done
- [ ] `balanceTx` + `signTx` → `balanceAndSign` migration done
- [ ] Import paths updated to barrel package (if using v4.0.3+)
- [ ] TypeScript compiles with zero errors
- [ ] All unit tests pass
- [ ] Wallet connection smoke test passes
- [ ] Proof provider connectivity verified
- [ ] Build scripts and CI pipelines updated
- [ ] README compatibility matrix updated

---

## Final Thoughts

The key insight from multiple Midnight SDK upgrades is this: **breaking changes are predictable**. They follow patterns — API renames, package consolidations, configuration simplifications, and CLI tool updates. Once you've seen the patterns, upgrades go from "panic fix" to "methodical migration."

The process is always the same:

1. **Read** the changelog and identify breaking changes
2. **Categorize** your compilation errors by pattern
3. **Apply** the corresponding migration pattern
4. **Test** contracts, TypeScript, and wallet integration
5. **Document** what changed for future reference

Midnight is building something genuinely novel — a production-grade ZK smart contract platform. The fast iteration pace is a feature, not a liability. With the right upgrade process, your dApps stay healthy and you spend less time fighting the framework and more time building privacy-preserving applications.

Stay updated, migrate methodically, and keep building.

---

*This tutorial is part of the Midnight Network bounty program. For more developer resources, visit [docs.midnight.network](https://docs.midnight.network).*
