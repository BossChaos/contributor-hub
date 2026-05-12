---
title: "Security Checklist for Midnight dApps Before Deployment"
published: true
tags: ["midnight", "blockchain", "security", "zeroknowledge", "web3"]
cover_image: ""
---

# Security Checklist for Midnight dApps Before Deployment

Deploying a dApp on Midnight is different from Ethereum or Solana. You're not just worried about reentrancy or overflow — you're dealing with zero-knowledge proofs, shielded state, and circuits that can accidentally expose secrets.

I've audited enough Midnight contracts to know where developers trip. This checklist covers the seven things that will get your dApp exploited or rejected before it even launches.

## 1. Audit Every `disclose()` Call

`disclose()` is the most dangerous function in your contract. It takes a shielded value and exposes it in plaintext on-chain. One misplaced call, and you've leaked a balance, a secret key, or a transaction amount.

### The Rule

Every `disclose()` must answer: **who needs to see this, and why can't they use a ZK proof instead?**

### Bad: Leaking a Balance

```compact
// WRONG — exposes the sender's full balance
circuit transfer(
    coin: Coin,
    amount: U64,
    recipient: ContractAddress
) {
    let balance = coin.value
    disclose(balance) // Everyone sees how much you had
    coin.spend()
    ledger.mint(recipient, amount)
}
```

### Good: Using ZK Range Proofs

```compact
// RIGHT — prove sufficient balance without revealing it
circuit transfer(
    coin: Coin,
    amount: U64,
    recipient: ContractAddress
) {
    // Prove coin.value >= amount without disclosing the value
    assert(coin.value >= amount)
    let change = coin.value - amount
    coin.spend()
    ledger.mint(recipient, amount)
    ledger.mint(coin.owner, change)
}
```

### Checklist Item 1-1

- [ ] Every `disclose()` has a documented reason
- [ ] No balances, secret keys, or transaction amounts are disclosed
- [ ] Public metadata (like token names) are the only disclosed values
- [ ] Alternative ZK proofs considered for each disclosure

## 2. Review `ownPublicKey()` Usage

`ownPublicKey()` returns the public key of the contract. This is a known vulnerability surface because if a circuit reveals the contract's public key in a way that links shielded transactions, you've broken privacy.

### The Vulnerability Pattern

When `ownPublicKey()` is used inside a circuit that also processes user coins, the public key can be correlated across transactions. An observer who sees the same public key appearing in multiple proofs can link those transactions together.

### Bad: Public Key in Circuit Logic

```compact
// WRONG — public key becomes part of the proof, enabling correlation
circuit deposit(coin: Coin) {
    let pk = kernel.self().ownPublicKey()
    // Using pk in circuit computation leaks it into the proof
    assert(pk == coin.owner)
    coin.spend()
    ledger.mint(kernel.self(), coin.value)
}
```

### Good: Isolate Public Key Usage

```compact
// RIGHT — public key only used for ledger operations, not circuit logic
circuit deposit(coin: Coin) {
    // Verify coin ownership through signature, not public key comparison
    coin.spend()
    ledger.mint(kernel.self()<LedgerType, ContractAddress>(), coin.value)
}
```

### Checklist Item 2-1

- [ ] `ownPublicKey()` is not used inside ZK circuit computation
- [ ] Contract public key only appears in ledger state management
- [ ] No circuit outputs or disclosures include the contract's public key
- [ ] Cross-transaction linking via public key is impossible

## 3. Verify Replay Protection

Replay attacks on Midnight are subtle. If a coin can be spent twice — once in a valid transaction and once in a forged replay — you've lost funds. Midnight provides two mechanisms: **nonces** and **nullifiers**.

### Nullifier-Based Protection

When a coin is spent, its nullifier is published on-chain. Any attempt to spend the same coin again will fail because the nullifier already exists.

```compact
circuit transfer(
    coin: Coin,
    amount: U64,
    recipient: PublicKey,
    changeAddress: ContractAddress
) {
    // The coin's nullifier is automatically checked against the ledger
    // If this coin was already spent, the transaction fails
    coin.spend()
    
    let change = coin.value - amount
    assert(change >= 0u64)
    
    ledger.mint(recipient, amount)
    ledger.mint(changeAddress, change)
}
```

### Nonce-Based Protection

For contracts that need custom replay protection (like vote counting or one-time claims), use a nonce:

```compact
ledger contractVotes {
    voted: Set<Nullifier>
}

circuit vote(proposalId: U64, voterCoin: Coin) {
    let nullifier = voterCoin.nullifier()
    
    // Check this voter hasn't already voted
    assert(!ledger.voted.member(nullifier))
    
    // Record the vote
    ledger.voted.insert(nullifier)
    
    voterCoin.spend()
}
```

### Checklist Item 3-1

- [ ] Every coin spend uses `coin.spend()` which generates a nullifier
- [ ] No coins can be spent without nullifier verification
- [ ] Custom replay protection (nonces) used for application-specific logic
- [ ] Nullifier sets are properly maintained in the ledger

## 4. Review Exported Ledger Fields

Every field in your `ledger` is public on-chain. Even though coin values are shielded, the ledger structure itself is visible. If you put sensitive data in a ledger field, everyone can see it.

### Bad: Sensitive Data in Ledger

```compact
// WRONG — stores private vote counts in public ledger
ledger election {
    candidateA_votes: U64    // Everyone can see the count
    candidateB_votes: U64    // Everyone can see the count
    voterIds: List<U256>     // Everyone can see who voted
}
```

### Good: Shielded Vote Counting

```compact
// RIGHT — only stores nullifiers, counts are computed off-chain
ledger election {
    voted: Set<Nullifier>    // Only nullifiers, no identities
}

// Vote counts are computed off-chain from ZK proofs
```

### Checklist Item 4-1

- [ ] No secret keys, private data, or sensitive amounts in ledger fields
- [ ] Ledger fields only contain what must be publicly verified
- [ ] Set/Map fields use nullifiers or hashes, not plaintext identities
- [ ] Total supply fields are intentionally public (acceptable)

## 5. Verify Witness Implementation Correctness

Witnesses are the inputs to your ZK circuits. If a witness is constructed incorrectly, the proof will either fail to generate or — worse — generate but be invalid.

### The Witness Pattern

```compact
circuit transferWitness {
    // Inputs that must be provided to generate the proof
    input coin: Coin
    input amount: U64
    input recipient: PublicKey
    
    // The circuit verifies these inputs satisfy the contract logic
    assert(coin.value >= amount)
    assert(coin.isValid())
}
```

### Common Witness Mistakes

**Missing input validation:**
```compact
// WRONG — no validation on amount, could be zero or overflow
circuit badTransfer(coin: Coin, amount: U64) {
    coin.spend()
    ledger.mint(recipient, amount) // amount could be 0
}

// RIGHT — validate all inputs
circuit goodTransfer(coin: Coin, amount: U64) {
    assert(amount > 0u64)
    assert(coin.value >= amount)
    coin.spend()
    ledger.mint(recipient, amount)
}
```

**Incorrect type annotations:**
```compact
// WRONG — missing generic on kernel.self()
circuit brokenDeposit(coin: Coin) {
    let self = kernel.self() // Type inference fails
    coin.spend()
    ledger.mint(self, coin.value)
}

// RIGHT — explicit generic annotation
circuit fixedDeposit(coin: Coin) {
    let self = kernel.self()<LedgerType, ContractAddress>()
    coin.spend()
    ledger.mint(self, coin.value)
}
```

### Checklist Item 5-1

- [ ] All circuit inputs are validated with `assert()` statements
- [ ] No unchecked arithmetic operations (use saturating or checked math)
- [ ] `kernel.self()` has explicit generic type annotations
- [ ] Witnesses include all necessary fields for proof generation

## 6. Confirm Version Compatibility

Midnight's toolchain evolves quickly. A contract that compiled last month might fail today because of a breaking change in `compactc` or the runtime library.

### Pin Your Versions

```compact
// Always specify the pragma version
pragma language_version 0.23.0;
```

### Compatibility Checklist

- [ ] `compactc` version matches the target network's supported version
- [ ] `@midnight-ntwrk/compact-runtime` version is compatible with your contracts
- [ ] `@midnight-ntwrk/midnightjs` SDK version aligns with your node version
- [ ] No deprecated APIs used (check the Midnight changelog)

### Test on the Target Network

Before deploying to mainnet, run your contracts on Preview or Preprod:

```bash
# Compile with the correct compiler
compactc --skip-zk contracts/MyContract.compact managed/

# Verify the output
cat managed/compiler/contract-info.json | python3 -c "
import json, sys
info = json.load(sys.stdin)
print(f'Circuits: {len(info.get(\"circuits\", []))}')
print(f'Ledger: {info.get(\"ledger\", {})}')"
```

## 7. Test Proof Generation on Testnet

Your contract might compile, but can it actually generate proofs? This is the final gate before deployment.

### Proof Generation Test Script

```bash
#!/bin/bash
# test_proofs.sh — Verify all circuits generate valid proofs

set -euo pipefail

CONTRACT="contracts/MyContract.compact"
OUTPUT="managed/"

echo "=== Compiling contract ==="
compactc "$CONTRACT" "$OUTPUT"

if [ $? -ne 0 ]; then
    echo "FAIL: Compilation failed"
    exit 1
fi

echo "=== Checking circuit outputs ==="
CIRCUITS=$(cat "$OUTPUT/compiler/contract-info.json" | \
    python3 -c "import json,sys; [print(c) for c in json.load(sys.stdin).get('circuits', {}).keys()]")

for circuit in $CIRCUITS; do
    echo "  Checking $circuit..."
    if [ ! -f "$OUTPUT/zkir/$circuit.zkir" ]; then
        echo "  FAIL: No ZKIR file for $circuit"
        exit 1
    fi
done

echo "=== All circuits have ZK proofs ==="
echo "✅ Ready for testnet deployment"
```

### Checklist Item 7-1

- [ ] All circuits compile without warnings
- [ ] ZKIR proof files generated for every non-pure circuit
- [ ] Proof generation succeeds on local testnet
- [ ] Transaction submission to testnet node succeeds
- [ ] Edge cases tested (zero amounts, max values, replay attempts)

## The Complete Pre-Deployment Checklist

Print this. Check every box. Then deploy.

### Security Audit

- [ ] **`disclose()` audit**: No secret leaks in any circuit
- [ ] **`ownPublicKey()` review**: No public key correlation attacks
- [ ] **Replay protection**: Nullifiers or nonces prevent double-spends
- [ ] **Ledged fields**: No sensitive data exposed publicly
- [ ] **Witness validation**: All inputs checked, types correct

### Engineering

- [ ] **Version compatibility**: Compiler, runtime, SDK aligned
- [ ] **Proof generation**: All circuits generate valid proofs
- [ ] **Test coverage**: Unit tests for all circuits and edge cases
- [ ] **Error messages**: Clear, non-leaking error descriptions

### Deployment

- [ ] **Testnet validation**: Contract works on Preview/Preprod
- [ ] **Node compatibility**: Compatible with target network version
- [ ] **Monitoring**: Health checks and logging in place
- [ ] **Rollback plan**: Known procedure if something breaks

## Final Thoughts

Midnight's privacy model is powerful but unforgiving. A single `disclose()` in the wrong place can expose everything you're trying to protect. A missing nullifier check can let attackers drain your contract.

The good news: most vulnerabilities are preventable with a systematic review. Use this checklist before every deployment. Share it with your team. And when in doubt, assume the worst — if a value *could* be leaked, it will be.

---

*This guide covers the Midnight network as of 2025. Check the [official docs](https://docs.midnight.network) for the latest API changes. Found a security pattern not covered here? Drop it in the comments.*
