# Replay Attack Prevention: What I Learned Breaking Midnight Contracts

## The First Time It Happened to Me

I was testing a simple token transfer contract on Midnight testnet. Everything looked fine — transfers worked, balances updated, the whole thing compiled without warnings. So I did what any curious developer would do: I submitted the same transaction twice.

Both went through.

The second transfer shouldn't have. The nonce was wrong, the counter should've caught it, the whole defense-in-depth strategy should've stopped it cold. But it didn't. Two identical transfers, same amount, same recipient, same everything. The contract just... accepted them both.

That's when I started taking replay attacks seriously.

This isn't a tutorial about what replay attacks are. If you're reading this, you probably already know. This is about the three mechanisms Midnight gives you to prevent them, what actually works in practice, and the mistakes I made so you don't have to.

## Counter-Based Nonces: Simple Until It Isn't

Here's the basic pattern everyone shows you:

```typescript
state {
    operationCounter: Counter,
}

init {
    state.operationCounter = 0,
}

method transfer(user: Address, nonce: U256, recipient: Address, amount: U256) {
    assert(nonce == state.operationCounter, "Invalid nonce");
    // transfer logic
    state.operationCounter = state.operationCounter + 1;
}
```

Clean, right? It works for single-user scenarios. But here's where it gets interesting.

### The Concurrency Problem

I built a contract that allowed multiple operations per block. Users could batch transfers, swap tokens, and stake — all in one transaction. The counter approach broke immediately.

Why? Because if user A submits two operations in the same block, they both need the same nonce (the current counter value). But the counter only increments after the first one processes. So the second one fails with "invalid nonce" even though it's a legitimate operation.

The fix? You need per-user counters:

```typescript
state {
    userCounters: Map[Address, U256],
}

method transfer(user: Address, nonce: U256, recipient: Address, amount: U256) {
    expectedNonce: U256 = state.userCounters.get(user).unwrapOr(0);
    assert(nonce == expectedNonce, "Invalid nonce for user");
    state.userCounters = state.userCounters.insert(user, expectedNonce + 1);
    // transfer logic
}
```

This works better but introduces a new problem: **nonce management on the client side**. Your frontend now needs to track each user's current nonce, handle race conditions when multiple tabs are open, and deal with failed transactions that don't increment the counter.

I've seen production contracts where the nonce management code was more complex than the actual business logic. That's a warning sign.

### When Counters Actually Work

Counters are great when:
- Single user, sequential operations (most wallets)
- You control the client and can manage nonce state
- Simplicity matters more than flexibility

They fall apart when:
- Multiple concurrent operations
- You need to support batch transactions
- Client-side nonce management becomes a burden

## Nullifiers: The Cryptographic Approach

`persistentCommit(secret, context)` is Midnight's built-in way to generate unique, non-reversible identifiers. The function takes a secret and a context, and produces a nullifier that's cryptographically bound to both inputs.

Here's the basic pattern:

```typescript
state {
    usedNullifiers: Set[Bytes],
}

init {
    state.usedNullifiers = Set.empty[Bytes],
}

method vote(voter: Address, secret: Bytes, context: Bytes, choice: Bytes) {
    nullifier: Bytes = persistentCommit(secret, context);
    assert(!state.usedNullifiers.contains(nullifier), "Already voted");
    // vote processing
    state.usedNullifiers = state.usedNullifiers.add(nullifier);
}
```

This is more flexible than counters because:
- No sequential ordering required
- Works with concurrent operations
- Cryptographic guarantees of uniqueness

But there are real-world gotchas that nobody mentions in the docs.

### The Secret Management Problem

Your nullifier is only as good as your secret. If an attacker can guess or derive the secret, they can generate valid nullifiers and bypass your protection entirely.

I've seen contracts where the "secret" was derived from predictable data — a user's address, a timestamp, something that could be brute-forced. That's not a secret, that's a suggestion.

What actually works:
- Use cryptographically secure random values
- Generate secrets client-side, never transmit them
- Consider using a commitment scheme where the secret is revealed later

Here's a pattern I've used successfully:

```typescript
// Client generates: secret = randomBytes(32)
// Client commits: commitment = hash(secret)
// Contract stores: commitment (not the secret)
// Later: client reveals secret, contract verifies commitment matches

method commitVote(voter: Address, commitment: Bytes) {
    // Store commitment, no secret needed yet
    state.commitments = state.commitments.insert(voter, commitment);
}

method revealVote(voter: Address, secret: Bytes, choice: Bytes) {
    commitment: Bytes = state.commitments.get(voter).unwrapOr(b"");
    assert(hash(secret) == commitment, "Commitment mismatch");
    
    nullifier: Bytes = persistentCommit(secret, voter.bytes());
    assert(!state.usedNullifiers.contains(nullifier), "Already revealed");
    
    // Process vote
    state.usedNullifiers = state.usedNullifiers.add(nullifier);
}
```

This commit-reveal pattern adds complexity but solves the secret management problem elegantly. The secret never leaves the client until reveal time, and even then, it's verified against the earlier commitment.

### Storage Growth: The Silent Killer

Every nullifier you add to the set stays there forever. For low-throughput contracts, this isn't a problem. For high-frequency operations, your storage grows linearly with each transaction.

I built a contract that processed 10,000 operations per hour. After a week, the nullifier set was massive. Gas costs went up. State sync times increased. The contract became slower.

Solutions I've tried:

1. **Nullifier expiration**: Remove old nullifiers after a certain period
2. **Merkle trees**: Store roots instead of individual nullifiers
3. **Off-chain tracking**: Keep the set off-chain, verify on-chain only when needed

The right approach depends on your throughput. For most contracts, simple expiration works fine:

```typescript
state {
    usedNullifiers: Map[Bytes, U256], // nullifier -> expiration block
    currentBlock: U256,
}

method addNullifier(nullifier: Bytes, expirationBlocks: U256) {
    expirationBlock: U256 = state.currentBlock + expirationBlocks;
    state.usedNullifiers = state.usedNullifiers.insert(nullifier, expirationBlock);
}

method isNullifierUsed(nullifier: Bytes): Bool {
    expiration: U256 = state.usedNullifiers.get(nullifier).unwrapOr(0);
    if (state.currentBlock > expiration) {
        // Expired, remove it
        state.usedNullifiers = state.usedNullifiers.remove(nullifier);
        return false;
    }
    return true;
}
```

This keeps storage bounded but introduces a new consideration: expired nullifiers can be reused. Make sure your expiration period is long enough to prevent replay but short enough to manage storage.

## Domain Separation: When Context Matters

Domain separation solves a problem that sounds simple but is surprisingly tricky: how do you ensure a transaction valid in one context can't be replayed in another?

Imagine you have two contracts: a token contract and a staking contract. Both use the same nullifier mechanism. Without domain separation, a nullifier used in the token contract could potentially be reused in the staking contract. Same secret, same context, same nullifier.

Domain separation adds a unique identifier to each contract or operation:

```typescript
state {
    domainTag: Bytes,
    usedNullifiers: Set[Bytes],
}

init {
    state.domainTag = b"MYTOKEN_V1",
    state.usedNullifiers = Set.empty[Bytes],
}

method transfer(user: Address, recipient: Address, amount: U256) {
    domainData: Bytes = state.domainTag.concat(b"TRANSFER").concat(user.bytes()).concat(recipient.bytes()).concat(amount.bytes());
    operationHash: Bytes = hashBlake2b(domainData);
    
    assert(!state.usedNullifiers.contains(operationHash), "Already executed");
    // transfer logic
    state.usedNullifiers = state.usedNullifiers.add(operationHash);
}
```

The domain tag should be:
- Unique per contract deployment
- Include version information
- Be documented so other developers can verify it

I've seen contracts where the domain tag was just a string literal. That works until you deploy a new version and forget to update the tag. Then you have two contracts with the same domain tag, and nullifiers can leak between them.

### Versioning Your Domain Tags

Here's a pattern that's worked well for me:

```typescript
// Contract v1
state.domainTag = b"MYTOKEN_V1_2024"

// Contract v2 (after upgrade)
state.domainTag = b"MYTOKEN_V2_2025"

// Different network
state.domainTag = b"MYTOKEN_V2_TESTNET_2025"
```

The format doesn't matter as long as it's unique and documented. What matters is that you think about this during design, not after deployment.

## The Patterns I Keep Coming Back To

After building and reviewing a lot of Midnight contracts, here are the patterns that actually hold up in practice:

### 1. Start Simple, Add Complexity Only When Needed

The counter approach works for most single-user scenarios. Don't over-engineer nullifiers or domain separation until you have a concrete need. I've seen contracts where the replay prevention was more complex than the business logic. That's a code smell.

### 2. Test Your Defense, Not Just Your Happy Path

Every contract I build gets a replay test suite:
- Submit the same transaction twice
- Submit with invalid nonces
- Submit with expired nullifiers
- Submit across different contexts (if using domain separation)

If your contract doesn't have these tests, you don't know if your replay prevention works. You're hoping.

### 3. Document Your Choices

Future you (and future auditors) will thank you for explaining why you chose a particular replay prevention mechanism. A few lines of documentation in the contract source can save hours of confusion later.

### 4. Monitor Storage Growth

If you're using nullifier-based prevention, track your set size over time. Set up alerts for when storage grows beyond expected thresholds. I've seen contracts slow to a crawl because nobody monitored nullifier accumulation.

### 5. Consider the Client-Side Impact

Your replay prevention mechanism affects how clients interact with your contract. Counters require nonce management. Nullifiers require secret generation. Domain separation requires context tracking. Make sure your client library handles these properly, or you'll spend more time debugging client issues than contract issues.

## What I Wish I'd Known Earlier

- **Counter overflow is real.** Use `U256` for counters, not smaller types. A `U64` seems like plenty until you're processing thousands of operations per second.
- **Nullifier sets grow faster than you think.** Plan for expiration or cleanup from day one.
- **Domain tags need versioning.** Treat them like API versions — changing them is a breaking change.
- **Test on testnet before mainnet.** Replay attacks are much cheaper to fix in testing.
- **Read the Compact docs carefully.** `persistentCommit` behavior changed between versions. Make sure you're using the right version for your contract.

## Conclusion

Replay prevention isn't a one-size-fits-all problem. Midnight gives you counters, nullifiers, and domain separation — three different tools for three different scenarios. The key is understanding when each one works, what trade-offs you're making, and how to test your implementation.

The contract I broke that first time? I fixed it with a simple counter. It's been running for months without a single replay issue. Sometimes the simplest solution is the right one.

But I also learned that sometimes you need the cryptographic guarantees of nullifiers, or the context isolation of domain separation. The important thing is making that choice deliberately, not by accident.

## Resources

- [Midnight Documentation](https://docs.midnight.network)
- [Compact Language Reference](https://docs.midnight.network/relnotes/compact)
- [Security Best Practices](https://docs.midnight.network/security)
- [Contributor Hub](https://github.com/midnightntwrk/contributor-hub)

---

*This tutorial is part of the Midnight Bounty Program. For more information, visit the [Contributor Hub](https://github.com/midnightntwrk/contributor-hub).*
