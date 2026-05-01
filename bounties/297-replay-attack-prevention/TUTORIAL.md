# Replay Attack Prevention in Compact: Nonces, Nullifiers & Domain Separation

## Introduction

Replay attacks are one of those issues that sound theoretical until you see them in production. An attacker watches a valid transaction, copies it, maybe tweaks the timestamp, and submits it again. On a public blockchain, this is trivial because everything is visible. The damage ranges from duplicate payments to unauthorized state changes, depending on what your contract does.

Midnight's Compact language gives you three solid ways to prevent this. Each has different trade-offs, and the right choice depends on your specific use case. This tutorial walks through all three with working examples you can adapt for your own contracts.

## Prerequisites

Before we dive in, make sure you have:

- Midnight smart contract basics down
- Node.js and npm installed
- Compact compiler (`@midnight-ntwrk/midnight-js-compact`)
- Some familiarity with TypeScript and crypto concepts
- Access to Midnight testnet or a local dev environment

If you're new to Compact, check out the [official docs](https://docs.midnight.network) first.

## Method 1: Counter-Based Nonces

The counter approach is probably the most intuitive. Each operation needs an incrementing nonce that matches the contract's internal counter. Once processed, the counter goes up, and any old nonce becomes invalid.

Think of it like Ethereum's transaction nonces — each transaction must include the right nonce value, and once it's processed, that nonce is done. Trying to replay it with an old nonce just fails the assertion.

Here's what it looks like in practice:

```typescript
state {
    operationCounter: Counter,
}

init {
    state.operationCounter = 0,
}

method counterBasedNonce(user: Address, nonce: U256, amount: U256) {
    assert(nonce == state.operationCounter, "Invalid nonce: expected incrementing value");
    
    // ... your business logic here ...
    
    state.operationCounter = state.operationCounter + 1;
}
```

When this works well:

- Simple operations that naturally happen in sequence
- When you need to track the order of operations
- Low storage overhead (just one counter)

When it doesn't:

- Concurrent operations will fail if they arrive out of order
- You need to handle nonce management on the client side

One thing to watch for: counter overflow in long-running contracts. If your counter is a fixed-size integer, make sure it's big enough for your expected operation volume. A `U256` should last a while, but it's worth thinking about during design.

## Method 2: Set-Based Nullifiers

This one uses `persistentCommit(secret, context)` to generate a unique cryptographic nullifier. The function creates a binding commitment — same inputs always produce the same output, but you can't reverse it or find collisions. Once a nullifier is used, you add it to a set and reject any duplicates.

```typescript
state {
    usedNullifiers: Set[Bytes],
}

init {
    state.usedNullifiers = Set.empty[Bytes],
}

method nullifierBasedPrevention(user: Address, secret: Bytes, context: Bytes, amount: U256) {
    nullifier: Bytes = persistentCommit(secret, context);
    
    assert(!state.usedNullifiers.contains(nullifier), "Nullifier already used: replay detected");
    
    // ... your business logic here ...
    
    state.usedNullifiers = state.usedNullifiers.add(nullifier);
}
```

The key insight here is that `persistentCommit` gives you cryptographic uniqueness without requiring sequential ordering. This is useful when operations can happen in any order but you still need to prevent duplicates.

The main trade-off is storage. Your nullifier set grows with each operation. For high-throughput contracts, this can become significant. Some contracts implement nullifier expiration to manage this — old nullifiers get pruned after a certain period.

Make sure your secrets are actually secret. If an attacker can guess or derive the secret, they can generate valid nullifiers. Use cryptographically secure random values for secrets.

## Method 3: Domain Separation Tags

Domain separation solves a different problem: preventing a transaction valid in one context from being replayed in another. If your contract has multiple functions, you don't want a transaction meant for function A to work when submitted to function B.

The idea is simple: combine a domain tag (unique to your contract) with the operation type and data, then hash everything together. This creates a unique identifier for each operation in its specific context.

```typescript
state {
    domainTag: Bytes,
    usedNullifiers: Set[Bytes],
}

init {
    state.domainTag = b"REPLAY_DOMAIN_V1",
    state.usedNullifiers = Set.empty[Bytes],
}

method domainSeparatedOperation(user: Address, operationType: Bytes, data: Bytes, amount: U256) {
    domainData: Bytes = state.domainTag.concat(operationType).concat(data);
    
    operationHash: Bytes = hashBlake2b(domainData);
    
    assert(!state.usedNullifiers.contains(operationHash), "Operation already executed");
    
    // ... your business logic here ...
    
    state.usedNullifiers = state.usedNullifiers.add(operationHash);
}
```

Domain separation is especially important for complex contracts with multiple entry points. It's also useful when you're deploying similar contracts across different networks — each deployment gets its own domain tag.

Choose your domain tag carefully. It should be unique per contract deployment and include version information if you plan upgrades. `REPLAY_DOMAIN_V1` is a reasonable starting point, but you might want something more specific like `MYTOKEN_V1_MAINNET`.

## Comparison: When to Use What

| Method | Complexity | Storage | Best For |
|--------|------------|---------|----------|
| Counter-based | Low | Minimal | Sequential operations |
| Nullifier-based | Medium | Growing | Cryptographic uniqueness |
| Domain separation | High | Growing | Cross-circuit prevention |

The counter method is simplest but requires sequential ordering. Nullifiers give you cryptographic guarantees but grow over time. Domain separation is the most flexible but also the most complex to implement correctly.

In practice, many production contracts combine methods. A counter + nullifier approach gives you both ordering guarantees and cryptographic uniqueness, which is overkill for simple cases but worth it for high-value operations.

## Best Practices We've Learned

After reviewing a lot of Compact contracts, here are the patterns that keep showing up as important:

- **Test your replay prevention.** Don't just assume it works. Write tests that try to replay transactions with old nonces and nullifiers.
- **Document your approach.** Future auditors (and future you) will thank you for explaining why you chose a particular method.
- **Consider gas costs.** Nullifier-based methods use more storage, which costs more. Factor this into your design.
- **Use unique domain tags.** Every contract deployment should have its own domain tag. Don't reuse tags across contracts.
- **Monitor storage growth.** If you're using nullifiers, keep an eye on set size. Plan for cleanup strategies if needed.

## Real-World Examples

### Token Transfer with Counter

```typescript
method secureTransfer(user: Address, nonce: U256, recipient: Address, amount: U256) {
    assert(nonce == state.transferCounter, "Invalid transfer nonce");
    // Transfer logic
    state.transferCounter = state.transferCounter + 1;
}
```

### Voting with Nullifiers

```typescript
method castVote(voter: Address, secret: Bytes, context: Bytes, vote: Bytes) {
    nullifier: Bytes = persistentCommit(secret, context);
    assert(!state.usedVotes.contains(nullifier), "Vote already cast");
    // Vote processing
    state.usedVotes = state.usedVotes.add(nullifier);
}
```

### Multi-Function Contract with Domain Separation

```typescript
method executeOperation(user: Address, operationType: Bytes, data: Bytes) {
    domainData: Bytes = state.domainTag.concat(operationType).concat(data);
    operationHash: Bytes = hashBlake2b(domainData);
    assert(!state.executedOperations.contains(operationHash), "Operation already executed");
    // Operation execution
    state.executedOperations = state.executedOperations.add(operationHash);
}
```

## Conclusion

Replay prevention isn't optional for production contracts. Midnight gives you the tools — counter nonces for simple cases, nullifiers for cryptographic uniqueness, domain separation for complex contracts. Pick what fits your use case, test it thoroughly, and document your choices.

The most common mistake we see is choosing a method without thinking about the trade-offs. Counter-based is simplest but requires ordering. Nullifiers are flexible but grow over time. Domain separation is most secure but also most complex. There's no single right answer — it depends on your contract.

## Resources

- [Midnight Documentation](https://docs.midnight.network)
- [Compact Language Reference](https://docs.midnight.network/relnotes/compact)
- [Security Best Practices](https://docs.midnight.network/security)
- [Contributor Hub](https://github.com/midnightntwrk/contributor-hub)

---

*This tutorial is part of the Midnight Bounty Program. For more information, visit the [Contributor Hub](https://github.com/midnightntwrk/contributor-hub).*
