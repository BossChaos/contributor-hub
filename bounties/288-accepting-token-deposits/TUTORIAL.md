# Accepting Token Deposits into a Contract: ReceiveShielded & Escrow Patterns

## Tutorial Overview

In this tutorial, you'll learn how to build a Compact contract that accepts shielded token deposits from users, stores them securely, and releases them on demand. This is a foundational pattern for escrow services, marketplaces, and any application where a contract needs to hold and manage shielded assets.

**What you'll build:** A `TokenEscrow` contract that demonstrates:
- `receiveShielded` — accepting shielded coins from users
- `QualifiedShieldedCoinInfo` — storing coins in contract ledger state
- `writeCoin` — converting raw coin info into qualified form
- `sendShielded` — releasing funds to recipients
- `mergeCoinImmediate` — combining multiple coins to reduce fragmentation

**Prerequisites:**
- Midnight development environment set up (see [Midnight Docs](https://docs.midnight.network))
- Basic understanding of shielded vs. unshielded tokens
- Familiarity with Compact contract syntax

---

## 1. The Problem: Why Contract-Held Coins Are Different

When you send a shielded coin to another user, the coin is created and delivered directly to their wallet. But when a **contract** needs to hold coins — think escrow, marketplace escrow, or a vault — the coin lifecycle changes fundamentally.

The contract can't just "receive" a coin the way a wallet does. It needs to:
1. Accept the incoming shielded coin via `receiveShielded`
2. Convert it to a `QualifiedShieldedCoinInfo` so it can be stored in ledger state
3. Later release it using `sendShielded` with the qualified coin reference

If you skip step 2, the coin is lost — it exists in the transaction but isn't tracked by the contract. This is the most common mistake developers make when building deposit-accepting contracts.

Here's the key distinction you need to understand:

- **User-held coins** live in the user's wallet. The wallet tracks them via incoming transactions and nullifiers.
- **Contract-held coins** live in the contract's ledger state. The contract must explicitly store them as `QualifiedShieldedCoinInfo` values.

---

## 2. Architecture: The Deposit Lifecycle

```
┌──────────┐     receiveShielded      ┌──────────────┐     writeCoin      ┌──────────────┐
│  User    │ ──── ShieldedCoinInfo ──▶│   Contract   │ ────────────────▶ │   Ledger     │
│  Wallet  │                          │   Circuit    │                    │   Storage    │
└──────────┘                          └──────────────┘                    └──────────────┘
                                                                             │
                                                                             │ sendShielded
                                                                             ▼
                                                                      ┌──────────────┐
                                                                      │  Recipient   │
                                                                      │  Wallet      │
                                                                      └──────────────┘
```

The flow has three phases:

1. **Deposit phase:** User sends a `ShieldedCoinInfo` to the contract. The contract calls `receiveShielded` to accept it, then `writeCoin` to store it.
2. **Storage phase:** The qualified coin sits in the contract's ledger as `QualifiedShieldedCoinInfo`. The contract can track it, merge it, or prepare it for withdrawal.
3. **Withdrawal phase:** The contract owner calls `sendShielded` with the qualified coin, releasing it to a recipient address.

---

## 3. The Smart Contract: TokenEscrow

Let's walk through the key parts of the `TokenEscrow` contract. The full code is in `token-escrow.compact`.

### 3.1 Contract State

The contract needs to track several things: who owns it (for withdrawal control), what coins it holds, and accounting data.

```compact
export contract TokenEscrow {
    private owner: Address;
    export sealed ledger deposits: Map<Bytes<32>, QualifiedShieldedCoinInfo>;
    export ledger totalDeposited: Persistent<Uint<256>>;
    export ledger totalWithdrawn: Persistent<Uint<256>>;
    export ledger depositors: Map<Bytes<32>, Address>;
    // ...
}
```

The `deposits` map is the critical piece. It maps a unique deposit ID to a `QualifiedShieldedCoinInfo`. This is how the contract tracks which coins it holds and can later release.

### 3.2 Accepting a Deposit

The deposit function is where `receiveShielded` and `writeCoin` come into play:

```compact
pub fn deposit(deposit_id: Bytes<32>, coin_info: ShieldedCoinInfo) -> Bytes<32> {
    // Step 1: Accept the shielded coin
    let qualified_coin = receiveShielded(coin_info);

    // Step 2: Store it in the contract ledger
    self.deposits.insert(deposit_id, qualified_coin);

    // Step 3: Track the depositor and update counters
    self.depositors.insert(deposit_id, caller());
    let current = self.totalDeposited.get();
    self.totalDeposited.set(current + coin_info.amount);

    deposit_id
}
```

Here's what happens under the hood:

- `receiveShielded(coin_info)` validates the incoming coin — checks its signature, ensures it hasn't been spent, and returns a `QualifiedShieldedCoinInfo`. This is the contract's way of saying "I accept this coin."
- `self.deposits.insert(...)` stores the qualified coin in the contract's ledger. Without this step, the coin would be accepted but immediately lost — the contract wouldn't be able to reference it later for withdrawal.

A common pitfall: if you call `receiveShielded` but forget to store the result, the coin is consumed by the transaction but never tracked. The contract's balance doesn't increase, and you can't withdraw it later. Always store the qualified coin.

### 3.3 Releasing Funds

Withdrawing is the reverse operation. The contract owner retrieves a qualified coin from storage and sends it to a recipient:

```compact
pub fn withdraw(deposit_id: Bytes<32>, recipient: Address) -> Bool {
    // Owner-only access control
    if (self.owner != caller()) {
        abort("only owner can withdraw");
    }

    // Retrieve the qualified coin
    let qualified_coin = self.deposits.get(deposit_id);

    // Remove from storage
    self.deposits.remove(deposit_id);
    self.depositors.remove(deposit_id);

    // Send to recipient
    sendShielded(recipient, qualified_coin);

    // Update accounting
    let current = self.totalWithdrawn.get();
    self.totalWithdrawn.set(current + qualified_coin.amount);

    true
}
```

Key points:
- `sendShielded` takes a `QualifiedShieldedCoinInfo` (not a raw `ShieldedCoinInfo`). This is why storing the qualified form matters.
- Always remove the coin from storage before sending. If you send first and then remove, a failed send could leave the coin in an inconsistent state.
- Access control is essential. Without it, anyone could withdraw funds from your escrow.

### 3.4 Merging Coins

When a contract holds many small deposits, it can become fragmented — too many small coins to efficiently use. `mergeCoinImmediate` combines multiple coins into one:

```compact
pub fn mergeDeposits(deposit_ids: Vector<Bytes<32>, 10>) -> Bytes<32> {
    if (self.owner != caller()) {
        abort("only owner can merge deposits");
    }

    let merged_coin = mergeCoinImmediate(deposit_ids, self.deposits);
    let new_id = sha256(deposit_ids[0], deposit_ids[deposit_ids.length - 1]);

    self.deposits.insert(new_id, merged_coin);
    self.deposits.remove(deposit_ids[0]);

    new_id
}
```

This is particularly useful for:
- Reducing the number of coins the contract holds (simplifying future withdrawals)
- Combining dust amounts into usable coins
- Preparing for large withdrawals that require a single qualified coin

---

## 4. SDK Integration: Depositing from TypeScript

Here's how a user would deposit tokens into the escrow from a TypeScript application:

```typescript
import { Contract } from "midnight-js";
import { v4 as uuid } from "uuid";

async function depositToEscrow(
  contract: Contract,
  amount: bigint,
  depositId: string
): Promise<void> {
  // Generate a unique deposit ID
  const id = depositId || uuid();

  // Call the deposit circuit function
  // The contract will receiveShielded and store the coin
  const tx = await contract.call.deposit({
    deposit_id: id,
    coin_info: {
      // The coin info is constructed by the SDK from the user's wallet
      // This includes the coin's value, ownership proof, and metadata
      amount: amount,
      // ... additional coin metadata from wallet
    },
  });

  console.log(`Deposit ${id} submitted: ${tx.hash}`);
}
```

The SDK handles the coin construction from the user's wallet. You just need to provide a unique deposit ID and the amount. The contract's `receiveShielded` takes care of validation and qualification.

---

## 5. Security Analysis

### 5.1 Access Control

The contract uses owner-only access control for withdrawals and merges. This is a simple pattern but has a critical assumption: the owner address must be set correctly at construction and never changed. If the owner key is compromised, all funds are at risk.

For production use, consider:
- Multi-signature ownership (require N-of-M signatures)
- Time-locked withdrawals (delay withdrawals by a configurable period)
- Withdrawal limits (cap the amount withdrawable per period)

### 5.2 Coin Loss Prevention

The most critical security consideration is preventing coin loss. This happens when:
- `receiveShielded` is called but the result isn't stored
- A deposit ID is reused, overwriting an existing qualified coin
- The contract is destroyed without withdrawing all funds

To prevent these:
- Always pair `receiveShielded` with a ledger insert
- Use unique, caller-generated deposit IDs (UUIDs work well)
- Implement a contract shutdown function that returns all funds

### 5.3 Reentrancy

Compact's execution model prevents traditional reentrancy attacks — circuit functions execute atomically. However, you should still be careful about state ordering: remove coins from storage before sending them, not after.

---

## 6. Testing Strategy

Here are the key test cases you should cover:

```
Happy Path:
  ✓ User deposits a coin → coin appears in deposits map
  ✓ Owner withdraws a deposit → recipient receives funds
  ✓ Owner merges multiple deposits → single qualified coin created

Edge Cases:
  ✓ Deposit with reused ID → overwrites existing (document this behavior)
  ✓ Withdraw non-existent deposit → contract aborts
  ✓ Merge with single deposit → returns same coin
  ✓ Withdraw after merge → works with merged coin ID

Security:
  ✓ Non-owner attempts withdrawal → rejected with error
  ✓ Non-owner attempts merge → rejected with error
  ✓ Deposit with zero amount → accepted (document if intentional)

Accounting:
  ✓ totalDeposited increases on deposit
  ✓ totalWithdrawn increases on withdrawal
  ✓ getBalance() returns correct remaining balance
```

---

## 7. Integration: Deploying the Escrow

Deploy the contract using the Midnight dApp toolkit:

```bash
# Compile the contract
midnight compile token-escrow.compact

# Deploy to testnet
midnight deploy token-escrow.compact \
  --constructor-args "$(midnight address)" \
  --network testnet

# The constructor takes the owner address
# All subsequent operations use the deployed contract address
```

After deployment, share the contract address with users who want to deposit. Each user generates their own deposit ID and calls the `deposit` circuit function.

---

## 8. Production Considerations

### 8.1 State Synchronization

The contract's ledger state must be synchronized with the network before any operation. If a user tries to deposit while the contract is behind on sync, the transaction may fail with error 1010 (invalid transaction). Always ensure your node is fully synced before interacting with the contract.

### 8.2 Gas Optimization

Each `receiveShielded` and `sendShielded` operation consumes gas. If your escrow handles many small deposits, consider:
- Batching deposits where possible
- Using `mergeCoinImmediate` periodically to reduce coin count
- Setting a minimum deposit amount to avoid dust accumulation

### 8.3 Key Management

The owner key is the single point of failure for fund withdrawals. Store it in a hardware wallet or use a multi-signature scheme. Never hardcode the owner address in client-side code — retrieve it from the contract's `getOwner()` function.

---

## 9. Advanced Use Cases

### Marketplace Escrow

Extend this pattern to build a marketplace escrow where:
- Buyer deposits funds into the escrow
- Seller delivers goods/services
- Buyer confirms receipt → owner (marketplace) releases funds to seller
- If dispute arises, funds can be returned to buyer

### Token Vault

Build a vault that accepts deposits and tracks ownership:
- Each depositor gets a receipt token (NFT or fungible token)
- Receipt tokens can be traded or transferred
- Burning the receipt token allows withdrawal of the underlying coins

### Multi-Party Escrow

Add time-locked withdrawals:
- Deposits can only be withdrawn after a configurable delay
- Allows for dispute resolution windows
- Useful for freelance work, real estate, and other high-value transactions

---

## 10. Conclusion

Accepting token deposits into a Compact contract requires understanding the difference between user-held and contract-held coins. The key operations — `receiveShielded`, `writeCoin`, and `sendShielded` — form a complete deposit-withdraw lifecycle that, when used correctly, provides a secure and private way for contracts to manage shielded assets.

The most important takeaway: **always store the result of `receiveShielded`**. A qualified coin that isn't stored in the ledger is a coin the contract can never use.

### Next Steps
- Explore the full `TokenEscrow` contract in `token-escrow.compact`
- Try deploying to Midnight testnet and making test deposits
- Read more about shielded tokens in the [Midnight Documentation](https://docs.midnight.network)

---

## Appendix A: API Reference

| Function | Description | Parameters | Returns |
|----------|-------------|------------|---------|
| `receiveShielded(coin_info)` | Accept a shielded coin into the contract | `ShieldedCoinInfo` | `QualifiedShieldedCoinInfo` |
| `writeCoin(qualified_coin)` | Store qualified coin in ledger | `QualifiedShieldedCoinInfo` | — |
| `sendShielded(recipient, coin)` | Release a qualified coin to an address | `Address`, `QualifiedShieldedCoinInfo` | — |
| `mergeCoinImmediate(ids, map)` | Merge multiple coins into one | `Vector<Bytes<32>>`, `Map` | `QualifiedShieldedCoinInfo` |

## Appendix B: Glossary

- **ShieldedCoinInfo**: Raw coin data received from a transaction. Not yet validated or qualified for contract storage.
- **QualifiedShieldedCoinInfo**: A validated coin that the contract can store and use. Produced by `receiveShielded`.
- **receiveShielded**: Circuit function that accepts a shielded coin and returns its qualified form.
- **sendShielded**: Circuit function that sends a qualified coin to a recipient address.
- **mergeCoinImmediate**: Circuit function that combines multiple qualified coins into a single coin.
- **writeCoin**: Operation that converts ShieldedCoinInfo to QualifiedShieldedCoinInfo for ledger storage.
