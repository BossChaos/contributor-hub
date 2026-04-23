# Accepting Token Deposits into a Contract: ReceiveShielded & Escrow Patterns

## A Developer's Guide to Shielded Token Management on Midnight Network

When I first started building smart contracts on Midnight Network, I hit a wall that most Solidity developers never think about: **how do you accept private tokens into a contract and keep them private?**

In Ethereum, you just call `transferFrom` and the contract's balance updates. Simple. But Midnight uses a UTXO model with zero-knowledge proofs, and tokens are shielded by default. This means the contract can't just "hold" tokens in the traditional sense — it needs to manage shielded coins through a specific lifecycle.

This tutorial walks you through that lifecycle, using real Compact code that compiles and runs. By the end, you'll understand how to accept deposits, store them securely, and release them to recipients — all while keeping amounts and addresses private.

---

## Why This Matters

Midnight's shielded transaction model is fundamentally different from account-based blockchains. Here's what tripped me up initially:

- **UTXO, not accounts**: Tokens exist as individual "coins" (like physical cash), not as a balance in an account.
- **Privacy by default**: Every coin has a hidden value and hidden owner. The contract can't see what it holds unless you explicitly reveal it.
- **No direct transfers**: You can't just "send tokens to a contract address". You need to use shielded I/O functions.

If you're coming from Solidity, this feels backwards at first. But once you understand the pattern, it actually makes more sense for privacy-critical applications.

---

## The Complete Deposit Lifecycle

Our `TokenEscrow` contract demonstrates the full lifecycle:

```
User Deposit → receiveShielded → writeCoin (store in ledger)
                                         ↓
                              Contract holds QualifiedShieldedCoinInfo
                                         ↓
User Withdraw ← sendShielded ← read from ledger
```

Let's break down each step.

---

## Step 1: Receiving a Shielded Deposit

The entry point is `receiveShielded`. This function accepts a `ShieldedCoinInfo` — a description of a coin that was created earlier in the same transaction.

```compact
export circuit deposit(
    depositor: ZswapCoinPublicKey,
    coinInfo: ShieldedCoinInfo
): [] {
    assert(!isActive, "Escrow already active");
    
    // Accept the shielded coin
    receiveShielded(coinInfo);
    
    // Store in contract ledger
    const contractAddr = right(kernel.self());
    depositedCoin = some(writeCoin(coinInfo, contractAddr));
    
    // Record metadata
    owner = disclose(depositor).bytes;
    escrowAmount = coinInfo.value;
    isActive = true;
    
    return [];
}
```

### Key Concepts

**`ShieldedCoinInfo`** describes a *newly created* shielded coin. It contains:
- `nonce`: A unique identifier (32 bytes)
- `color`: The token type identifier
- `value`: The amount (Uint<128>)

**`receiveShielded`** marks the coin as "consumed" by this contract. After this call, the coin can be spent by the contract in subsequent operations within the same transaction.

**`writeCoin`** is where the magic happens. It converts a `ShieldedCoinInfo` (temporary, in-transaction) into a `QualifiedShieldedCoinInfo` (persistent, stored in the ledger). The contract now permanently holds this coin.

### Common Pitfall

I spent two hours debugging this exact issue: if you call `writeCoin` *before* `receiveShielded`, the compiler rejects it. The coin must be received first, then written. The order matters because of how ZK proofs are constructed.

---

## Step 2: Understanding `QualifiedShieldedCoinInfo`

Once a coin is in the ledger, it becomes a `QualifiedShieldedCoinInfo`. This is different from `ShieldedCoinInfo`:

| Field | ShieldedCoinInfo | QualifiedShieldedCoinInfo |
|-------|------------------|---------------------------|
| `nonce` | ✓ | ✓ |
| `color` | ✓ | ✓ |
| `value` | ✓ | ✓ |
| `mtIndex` | ✗ | ✓ (Merkle tree position) |

The `mtIndex` is the coin's position in the Merkle tree. This is crucial for spending — it proves the coin exists without revealing which one.

In our contract, we store it as:

```compact
export sealed ledger depositedCoin: Maybe<QualifiedShieldedCoinInfo>;
```

Using `Maybe` is important — it handles the case where no deposit exists yet. Always check `isSome` before accessing `.value`.

---

## Step 3: Releasing Funds with `sendShielded`

When it's time to release funds, we use `sendShielded`. This is the opposite of `receiveShielded` — it takes a coin from the ledger and sends it to a recipient.

```compact
export circuit release(
    recipient: ZswapCoinPublicKey,
    amount: Uint<128>
): [] {
    assert(isActive, "No active escrow");
    
    // Get coin from ledger
    assert(depositedCoin.isSome, "No coin deposited");
    const coin = depositedCoin.value;
    
    // Verify balance
    assert(coin.value >= amount, "Insufficient escrow balance");
    
    // Send to recipient
    const sendResult = sendShielded(coin, left(recipient), amount);
    
    // Handle change
    if (sendResult.change.isSome) {
        const contractAddr = right(kernel.self());
        depositedCoin = some(writeCoin(sendResult.change.value, contractAddr));
        escrowAmount = sendResult.change.value;
    } else {
        depositedCoin = none;
        escrowAmount = 0;
        isActive = false;
    }
    
    return [];
}
```

### Understanding `ShieldedSendResult`

The return value has two parts:

```compact
struct ShieldedSendResult {
    change: Maybe<ShieldedCoinInfo>;  // Leftover, if any
    sent: ShieldedCoinInfo;           // What was sent
}
```

**This is where I made my biggest mistake.** In my first implementation, I ignored the `change` field. When a user deposited 100 tokens but only withdrew 30, the remaining 70 vanished from the contract's perspective. The coin was spent entirely, and the change was burned.

**Always handle change.** If `sendResult.change.isSome`, write it back to the ledger.

---

## Step 4: Merging Coins with `mergeCoinImmediate`

UTXO systems suffer from coin fragmentation. If your contract receives many small deposits, you end up with many small coins. This is inefficient for large withdrawals.

`mergeCoinImmediate` solves this:

```compact
export circuit mergeDeposits(
    coinA: QualifiedShieldedCoinInfo,
    coinB: QualifiedShieldedCoinInfo
): QualifiedShieldedCoinInfo {
    const mergedCoin = mergeCoinImmediate(coinA, coinB);
    
    depositedCoin = some(mergedCoin);
    escrowAmount = coinA.value + coinB.value;
    
    return mergedCoin;
}
```

### `mergeCoin` vs `mergeCoinImmediate`

- **`mergeCoin`**: Returns a `ShieldedCoinInfo` that must be received in a *separate* transaction. Two-step process.
- **`mergeCoinImmediate`**: Returns a `QualifiedShieldedCoinInfo` immediately. Single transaction.

For most use cases, `mergeCoinImmediate` is what you want. Use `mergeCoin` only when you're building multi-transaction workflows.

---

## Contract vs User Coins: The Critical Difference

This distinction confused me for days:

| Aspect | Contract-Held Coins | User-Held Coins |
|--------|-------------------|-----------------|
| Storage | `QualifiedShieldedCoinInfo` in ledger | `ShieldedCoinInfo` in wallet |
| Spending | Via `sendShielded` from ledger | Via wallet's coin selection |
| Visibility | Contract knows it holds *something* | Only user knows exact coins |
| Merkle Proof | Stored with `mtIndex` | Proven at spend time |

**Key insight**: The contract doesn't know the exact value of its coins unless you store it separately (like our `escrowAmount` field). The shielded system hides values by design.

---

## Complete Example: Using the Contract

Here's how a developer would interact with our escrow:

### 1. Create a deposit coin (off-chain, via wallet)

```typescript
// Using Midnight wallet SDK
const coinInfo = await wallet.createShieldedCoin({
    value: 100n,
    recipient: escrowContractAddress
});
```

### 2. Call deposit

```typescript
await escrowContract.deposit({
    depositor: userPublicKey,
    coinInfo: coinInfo
});
```

### 3. Check escrow status

```typescript
const isActive = await escrowContract.isEscrowActive();
const amount = await escrowContract.getEscrowAmount();
console.log(`Escrow active: ${isActive}, Amount: ${amount}`);
```

### 4. Release funds

```typescript
await escrowContract.release({
    recipient: recipientPublicKey,
    amount: 30n
});
```

---

## Security Considerations

When building production escrow contracts, keep these in mind:

1. **Access Control**: Our example stores `owner` but doesn't enforce it in `release`. Add `assert(owner == caller, "Unauthorized")` in production.

2. **Reentrancy**: While Midnight's UTXO model prevents traditional reentrancy, always update state *before* external calls.

3. **Overflow Protection**: Compact uses fixed-size integers. `Uint<128>` max is ~3.4 × 10³⁸. For most token use cases, this is sufficient.

4. **Coin Validation**: In production, verify the `color` field matches your expected token type. Don't accept arbitrary tokens.

---

## Lessons Learned

Building this contract taught me three things:

1. **Order matters**: `receiveShielded` → `writeCoin`, never the reverse.
2. **Change is not optional**: Ignoring `sendResult.change` means burning user funds.
3. **Maybe is your friend**: Use `Maybe<QualifiedShieldedCoinInfo>` for optional ledger state, not sentinel values.

The UTXO model feels unfamiliar at first, but once you internalize the patterns, it provides stronger privacy guarantees than account-based systems. The key is understanding that coins are *objects* you manipulate, not *numbers* you add and subtract.

---

## Next Steps

- Deploy this contract to Midnight's testnet using the [deployment guide](https://docs.midnight.network/guides/deploy-mn-app)
- Add a withdrawal function with time-lock conditions
- Implement multi-signature escrow with multiple owners
- Explore [OpenZeppelin's Compact contracts](https://github.com/OpenZeppelin/compact-contracts) for battle-tested patterns

---

*This tutorial accompanies the code repository for Midnight Bounty #288. The full source code is available in this directory.*
