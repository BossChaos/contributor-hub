# Replay Attack Prevention in Compact: Nonces, Nullifiers & Domain Separation

## Introduction

Replay attacks occur when an attacker intercepts a valid transaction and re-submits it multiple times to gain unauthorized benefits. In blockchain systems, this is particularly dangerous because transactions are public and can be observed by anyone. An attacker can copy a transaction, modify the timestamp or other metadata, and submit it again, potentially causing unintended state changes or financial losses.

This tutorial demonstrates three proven replay prevention mechanisms in Midnight's Compact language, each with different trade-offs in complexity, storage requirements, and security guarantees. Understanding these mechanisms is essential for building secure smart contracts that can withstand real-world attack scenarios.

## Prerequisites

- Basic understanding of Midnight smart contracts
- Node.js and npm installed
- Compact compiler (`@midnight-ntwrk/midnight-js-compact`)
- Familiarity with TypeScript and cryptographic concepts
- Access to Midnight testnet or local development environment

## Method 1: Counter-Based Nonces

### How It Works

Each operation requires an incrementing nonce that must match the contract's internal counter. Once used, the counter increments, making the previous nonce invalid. This is the simplest and most efficient replay prevention mechanism, suitable for operations that have a natural sequential ordering.

The counter-based approach is similar to how Ethereum handles transaction nonces. Each transaction must include the correct nonce value, and once processed, the counter advances. Any attempt to replay a transaction with an old nonce will fail the assertion check.

### Implementation

```typescript
// Contract state
state {
    operationCounter: Counter,
}

init {
    state.operationCounter = 0,
}

method counterBasedNonce(user: Address, nonce: U256, amount: U256) {
    // Verify nonce matches expected counter value
    assert(nonce == state.operationCounter, "Invalid nonce: expected incrementing value");
    
    // Process the operation
    // ... business logic ...
    
    // Increment counter after successful operation
    state.operationCounter = state.operationCounter + 1;
}
```

### When to Use

- ✅ Simple operations with sequential ordering
- ✅ When you need to track operation sequence
- ✅ Low storage overhead (single counter)
- ❌ Not suitable for concurrent operations
- ❌ Fails if operations are submitted out of order

### Security Considerations

- Nonce must be strictly incrementing
- Contract must maintain counter state persistently
- Front-running is still possible but replay is prevented
- Consider adding a grace period for out-of-order submissions
- Monitor for counter overflow in long-running contracts
- Implement proper error handling for invalid nonce values

## Method 2: Set-Based Nullifiers

### How It Works

Uses `persistentCommit(secret, context)` to generate a unique cryptographic nullifier. Once used, the nullifier is added to a used set, preventing reuse. This method provides cryptographic guarantees of uniqueness and is suitable for operations that don't have sequential ordering.

The `persistentCommit` function creates a binding commitment between a secret value and a context. This commitment is deterministic - the same inputs always produce the same output - but it's computationally infeasible to reverse or find collisions. This makes it ideal for replay prevention.

### Implementation

```typescript
// Contract state
state {
    usedNullifiers: Set[Bytes],
}

init {
    state.usedNullifiers = Set.empty[Bytes],
}

method nullifierBasedPrevention(user: Address, secret: Bytes, context: Bytes, amount: U256) {
    // Generate nullifier from secret and context
    nullifier: Bytes = persistentCommit(secret, context);
    
    // Check if nullifier has been used before
    assert(!state.usedNullifiers.contains(nullifier), "Nullifier already used: replay detected");
    
    // Process the operation
    // ... business logic ...
    
    // Add nullifier to used set
    state.usedNullifiers = state.usedNullifiers.add(nullifier);
}
```

### When to Use

- ✅ When you need cryptographic uniqueness
- ✅ For operations that don't have sequential ordering
- ✅ When you want to prevent replay across different contexts
- ❌ Requires careful secret management
- ❌ Storage grows with each operation

### Security Considerations

- `persistentCommit` provides cryptographic binding
- Secret must be kept confidential
- Context should include operation-specific data
- Set grows with each operation (storage consideration)
- Consider implementing nullifier expiration for long-running contracts
- Use unique secrets for each operation to prevent cross-operation replay
- Monitor set size to prevent storage exhaustion attacks

## Method 3: Domain Separation Tags

### How It Works

Combines a domain tag with operation type and data, then hashes the result. This prevents replay across different contract functions or circuits. Domain separation is particularly useful when you have multiple operation types that need to be distinguished from each other.

Domain separation ensures that a transaction valid in one context (e.g., function A) cannot be replayed in another context (e.g., function B). This is crucial for complex contracts with multiple entry points. The domain tag acts as a namespace, ensuring that operations in different contexts are cryptographically isolated.

### Implementation

```typescript
// Contract state
state {
    domainTag: Bytes,
    usedNullifiers: Set[Bytes],
}

init {
    state.domainTag = b"REPLAY_DOMAIN_V1",
    state.usedNullifiers = Set.empty[Bytes],
}

method domainSeparatedOperation(user: Address, operationType: Bytes, data: Bytes, amount: U256) {
    // Combine domain tag with operation type and data
    domainData: Bytes = state.domainTag.concat(operationType).concat(data);
    
    // Hash with domain separation
    operationHash: Bytes = hashBlake2b(domainData);
    
    // Verify operation hasn't been executed
    assert(!state.usedNullifiers.contains(operationHash), "Operation already executed");
    
    // Process the operation
    // ... business logic ...
    
    // Mark operation as used
    state.usedNullifiers = state.usedNullifiers.add(operationHash);
}
```

### When to Use

- ✅ When you have multiple operation types
- ✅ For cross-circuit replay prevention
- ✅ When you need to distinguish between different contexts
- ❌ More complex to implement correctly
- ❌ Requires careful domain tag management

### Security Considerations

- Domain tag should be unique per contract
- Operation type should be distinct for each function
- Hash function must be collision-resistant (Blake2b recommended)
- Consider versioning your domain tags for contract upgrades
- Include all relevant parameters in the domain data to prevent partial replay
- Use a consistent domain tag format across your contract suite

## Comparison Table

| Method | Complexity | Storage | Use Case | Security Level |
|--------|------------|---------|----------|----------------|
| Counter-based | Low | Minimal | Sequential operations | Medium |
| Nullifier-based | Medium | Growing | Cryptographic uniqueness | High |
| Domain separation | High | Growing | Cross-circuit prevention | Very High |

## Best Practices

1. **Choose the right method** based on your use case and security requirements
2. **Combine methods** for defense-in-depth (e.g., counter + nullifier)
3. **Test thoroughly** with simulated replay attacks before deployment
4. **Monitor storage** growth for nullifier-based methods
5. **Document your approach** clearly for auditors and users
6. **Consider gas costs** when choosing between methods
7. **Implement proper error handling** for failed assertions
8. **Use unique domain tags** for each contract deployment
9. **Version your domain tags** to handle contract upgrades
10. **Regularly audit** your replay prevention mechanisms
11. **Consider rate limiting** in addition to replay prevention
12. **Use unique identifiers** for each operation type

## Advanced: Combining Methods

For maximum security, you can combine multiple replay prevention mechanisms:

```typescript
method combinedPrevention(user: Address, nonce: U256, secret: Bytes, context: Bytes, amount: U256) {
    // Method 1: Counter-based nonce verification
    assert(nonce == state.operationCounter, "Invalid nonce");
    
    // Method 2: Nullifier-based uniqueness check
    nullifier: Bytes = persistentCommit(secret, context);
    assert(!state.usedNullifiers.contains(nullifier), "Nullifier already used");
    
    // Process the operation
    // ... business logic ...
    
    // Update state
    state.operationCounter = state.operationCounter + 1;
    state.usedNullifiers = state.usedNullifiers.add(nullifier);
}
```

This combined approach provides both sequential ordering guarantees and cryptographic uniqueness, making it extremely difficult for attackers to replay transactions. The counter ensures operations are processed in order, while the nullifier provides cryptographic proof that each operation is unique.

## Real-World Examples

### Example 1: Token Transfer with Counter-Based Nonce

```typescript
method secureTransfer(user: Address, nonce: U256, recipient: Address, amount: U256) {
    assert(nonce == state.transferCounter, "Invalid transfer nonce");
    // Transfer logic
    state.transferCounter = state.transferCounter + 1;
}
```

### Example 2: Voting with Nullifiers

```typescript
method castVote(voter: Address, secret: Bytes, context: Bytes, vote: Bytes) {
    nullifier: Bytes = persistentCommit(secret, context);
    assert(!state.usedVotes.contains(nullifier), "Vote already cast");
    // Vote processing
    state.usedVotes = state.usedVotes.add(nullifier);
}
```

### Example 3: Multi-Function Contract with Domain Separation

```typescript
method executeOperation(user: Address, operationType: Bytes, data: Bytes) {
    domainData: Bytes = state.domainTag.concat(operationType).concat(data);
    operationHash: Bytes = hashBlake2b(domainData);
    assert(!state.executedOperations.contains(operationHash), "Operation already executed");
    // Operation execution
    state.executedOperations = state.executedOperations.add(operationHash);
}
```

## Testing Your Implementation

Before deploying your contract, it's essential to test your replay prevention mechanisms thoroughly:

1. **Unit Tests**: Test each method with valid and invalid inputs
2. **Replay Simulation**: Attempt to replay transactions with old nonces/nullifiers
3. **Edge Cases**: Test boundary conditions (zero values, maximum values)
4. **Concurrent Operations**: Test behavior with multiple simultaneous operations
5. **Storage Analysis**: Monitor storage growth for nullifier-based methods

## Conclusion

Replay attack prevention is essential for secure smart contracts. Midnight's Compact language provides multiple mechanisms to prevent replay attacks:

- **Counter-based nonces** for simple sequential operations
- **Nullifier-based prevention** for cryptographic uniqueness
- **Domain separation** for cross-circuit security

Choose the method that best fits your use case, and consider combining them for maximum security. Always test your implementation thoroughly and follow security best practices to protect your users and assets.

## Resources

- [Midnight Documentation](https://docs.midnight.network)
- [Compact Language Reference](https://docs.midnight.network/relnotes/compact)
- [Security Best Practices](https://docs.midnight.network/security)
- [Contributor Hub](https://github.com/midnightntwrk/contributor-hub)

---

*This tutorial is part of the Midnight Bounty Program. For more information, visit the [Contributor Hub](https://github.com/midnightntwrk/contributor-hub).*
