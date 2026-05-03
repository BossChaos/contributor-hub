# Time and Deadlines in Compact: Block Time, Counters & the Uint<16> Ceiling

## A Developer's Guide to Time-Based Logic on Midnight Network

Time is one of the most critical — and most tricky — elements in smart contract development. Whether you're building a Dutch auction that needs to tick down prices, an escrow that releases funds after a timeout, or a vesting schedule that unlocks over months, you'll eventually need to ask the blockchain: *what time is it?*

On Midnight Network, time works differently than on Ethereum. There are no `block.timestamp` reads in the traditional sense. Instead, Compact gives you **block-time query functions** that let you compare the current block time against stored values, and **Counter** types that can track incremental state. But both come with important constraints that every developer needs to understand.

This tutorial walks you through everything you need to build time-sensitive contracts on Midnight. We'll cover the four block-time comparison functions, explain the `Uint<16>` ceiling on counter increments (max 65,535), explore four practical workarounds for storing timestamps, and build two complete contracts: a Dutch auction with deadline enforcement and an escrow with timeout and refund.

By the end, you'll know exactly how to handle time in Compact — including the edge cases that will break your contract if you get them wrong.

---

## Understanding Block Time in Compact

Midnight tracks time at the **block level**. Each block has an associated block time (expressed as a Unix timestamp — seconds since January 1, 1970). The blockchain doesn't give you the raw timestamp value to do arithmetic on; instead, it gives you **comparison functions** that tell you how the current block time relates to a value you already have stored.

This design is intentional. Because Midnight is a privacy-focused blockchain, exposing raw timestamps that could be correlated across transactions would leak information. The comparison-only model lets the contract enforce time rules without revealing when events actually happened.

### The Four Block-Time Query Functions

Compact provides four functions for comparing the current block time against a stored value:

**1. `blockTimeLt(value: Uint<64>): Bool`**

Returns `true` if the current block time is *strictly less than* the provided value. Use this to check if the current time is *before* a deadline.

```compact
// Check if auction has not yet started
const auctionStartTime: Uint<64> = 1700000000u64;
assert(blockTimeLt(auctionStartTime), "Auction has already started");
```

**2. `blockTimeGte(value: Uint<64>): Bool`**

Returns `true` if the current block time is *greater than or equal to* the provided value. This is the most common function — use it to check if a deadline has been reached.

```compact
// Check if withdrawal window has opened
const withdrawalWindow: Uint<64> = 1700086400u64;
assert(blockTimeGte(withdrawalWindow), "Withdrawal window not yet open");
```

**3. `blockTimeEq(value: Uint<64>): Bool`**

Returns `true` if the current block time is *exactly equal to* the provided value. This is rarely used in practice because block times rarely align perfectly, but it can be useful for testing or for events that must occur at an exact moment.

```compact
// Verify we're at the exact expected block time for a scheduled event
const scheduledMintTime: Uint<64> = 1700000000u64;
assert(blockTimeEq(scheduledMintTime), "Not the scheduled mint time");
```

**4. `blockTimeGt(value: Uint<64>): Bool`**

Returns `true` if the current block time is *strictly greater than* the provided value. Use this to check if the current time is *after* a deadline (when you need strict inequality).

```compact
// Check if grace period has expired (strictly after deadline)
const gracePeriodEnd: Uint<64> = 1700090000u64;
assert(blockTimeGt(gracePeriodEnd), "Still within grace period");
```

### Practical Pattern: Combining Comparisons

In practice, you'll often combine these functions to define a time window:

```compact
export circuit checkAuctionPhase(
    auctionStart: Uint<64>,
    auctionEnd: Uint<64>,
    currentBlockTime: Uint<64>
): Bool {
    // Auction is active: started (gte) and not ended (lt)
    return blockTimeGte(auctionStart) && blockTimeLt(auctionEnd);
}
```

Note that we pass `currentBlockTime` as a parameter rather than reading it directly. This is because Compact's block-time functions implicitly use the current block time — you don't need to fetch it first. The parameter pattern is useful when you want to test the function with specific values.

---

## Counters and the Uint<16> Ceiling

Beyond comparing block time, you'll often want to **store** time-related values — a deadline for an auction, an unlock timestamp for a vesting schedule, or a grace period for an escrow. This is where the `Counter` type comes in.

### What is Counter?

`Counter` is a special type in Compact designed for values that increment over time. It's often used for:

- **Nonces**: Ensuring transaction ordering and preventing replay attacks
- **Sequence numbers**: Tracking the order of operations within a contract
- **Timestamps stored incrementally**: Recording when events occur by incrementing a counter

A `Counter` is declared in your contract's state:

```compact
state auctionCounter: Counter;
state escrowCounter: Counter;
state globalNonce: Counter;
```

### The increment() Method and Its Ceiling

The `Counter.increment()` method increases the counter by a specified amount. Here's the critical constraint:

> **Each call to `increment()` can add at most 65,535 (2^16 - 1) to the counter.**

This is the `Uint<16>` ceiling. If you try to increment by more than 65,535 in a single call, the operation will overflow and fail.

```compact
// ✅ Valid: increment by 1,000
auctionCounter.increment(1000u16);

// ✅ Valid: increment by 65,535 (the ceiling)
auctionCounter.increment(65535u16);

// ❌ Invalid: increment by 65,536 — this will overflow and fail
auctionCounter.increment(65536u16);

// ❌ Also invalid: increment by 100,000 (exceeds ceiling)
auctionCounter.increment(100000u16);
```

### What Happens at the Ceiling?

If a counter reaches its maximum value (65,535 for `Uint<16>`), subsequent `increment()` calls cannot increase it further. The counter becomes effectively "frozen" — it will always read 65,535, and `increment()` will fail if you try to add any positive amount.

This is a fundamental limitation of the `Uint<16>` type. If you need to store values that can exceed 65,535, you need a workaround.

### Reading Counter Values

You can read the current value of a counter using `.read()`:

```compact
const currentAuctionCount: Uint<16> = auctionCounter.read();
assert(currentAuctionCount.neq(0u16), "No auctions have been created");
```

Note that `.read()` returns `Uint<16>`, so the maximum readable value is 65,535.

---

## Workarounds for Storing Timestamps

The `Uint<16>` ceiling creates a challenge when you need to store Unix timestamps. Unix timestamps are seconds since the epoch (January 1, 1970). As of 2024, the current timestamp is already well over 1,700,000,000 — far exceeding 65,535.

Here are four practical workarounds:

### Workaround 1: Hours-Since-Epoch Pattern

**Concept**: Divide the Unix timestamp by 3,600 (seconds per hour) to convert it to hours since epoch. This fits comfortably within `Uint<16>`.

**Calculation**:
- Current Unix timestamp: ~1,700,000,000
- Divided by 3,600: ~472,222 hours since epoch
- Still exceeds 65,535!

A better approach: divide by **6** to get 6-hour units, or use **days** (divide by 86,400):

```compact
// For deadlines within ~179 years (Uint<16> max / seconds_per_day)
const daysSinceEpoch = timestamp / 86400;  // Fits in Uint<16>

// For more precision: use 6-hour blocks (4 per day)
const sixHourBlocks = timestamp / 21600;  // ~78,704 blocks = ~180 years
```

**Compact Implementation**:

```compact
export circuit storeDeadline(
    rawTimestamp: Uint<64>
): Uint<16> {
    // Convert seconds to 6-hour blocks (21600 seconds each)
    // This gives us ~180 years of range before overflow
    const sixHourBlocks = rawTimestamp / 21600u64;
    return sixHourBlocks as Uint<16>;
}

export circuit deadlineToTimestamp(
    storedDeadline: Uint<16>,
    currentBlockTime: Uint<64>
): Bool {
    // Convert back: stored value * 21600 = deadline in seconds
    const deadlineSeconds: Uint<64> = storedDeadline as Uint<64> * 21600u64;
    return blockTimeGte(deadlineSeconds);
}
```

**Trade-off**: You lose precision (rounding to 6-hour intervals). Acceptable for deadline checks, not for precise timestamps.

---

### Workaround 2: Multiple Increments Pattern

**Concept**: Use two counters: one for "epoch hours" (the main counter) and one for "additional hours" (overflow tracking). When the main counter hits its ceiling, increment the overflow counter instead.

```compact
state deadlineHours: Counter;       // Stores epoch hours (0-65535)
state deadlineOverflow: Counter;     // Stores overflow in 65536-hour chunks

export circuit storeDeadlineTimestamp(
    rawTimestamp: Uint<64>
): [] {
    const hoursSinceEpoch = rawTimestamp / 3600u64;
    
    // Calculate overflow chunks (each chunk = 65536 hours)
    const overflowChunks = hoursSinceEpoch / 65536u64;
    const remainingHours = hoursSinceEpoch % 65536u64;
    
    // Store base hours in main counter
    deadlineHours.increment(remainingHours as Uint<16>);
    
    // Store overflow in separate counter
    deadlineOverflow.increment(overflowChunks as Uint<16>);
    
    return [];
}

export circuit checkDeadline(
    rawCurrentTime: Uint<64>
): Bool {
    const currentHours = rawCurrentTime / 3600u64;
    const currentOverflow = currentHours / 65536u64;
    const currentRemaining = currentHours % 65536u64;
    
    const storedHours = deadlineHours.read();
    const storedOverflow = deadlineOverflow.read();
    
    // Compare overflow first (higher-order)
    if (currentOverflow > storedOverflow) {
        return true;  // Deadline passed
    }
    if (currentOverflow < storedOverflow) {
        return false;  // Deadline not yet passed
    }
    
    // Overflow equal, compare remaining hours
    return currentRemaining >= storedHours;
}
```

**Trade-off**: More complex logic, but supports full timestamp range with hour precision.

---

### Workaround 3: Splitting into deadline_hi + deadline_lo

**Concept**: Store the timestamp as two `Uint<16>` fields — a high 16 bits and a low 16 bits. Combined, they give you 32 bits of range (~4,294,967,295), which covers Unix timestamps until 2106.

```compact
state deadline_hi: Uint<16>;  // Upper 16 bits
state deadline_lo: Uint<16>;  // Lower 16 bits

export circuit storeDeadline(
    rawTimestamp: Uint<64>
): [] {
    deadline_hi = (rawTimestamp >> 16) as Uint<16>;
    deadline_lo = (rawTimestamp & 0xFFFFu64) as Uint<16>;
    return [];
}

export circuit deadlinePassed(): Bool {
    // Get current block time as two Uint<16> parts
    const currentTime: Uint<64> = ...;  // Would come from witness
    const current_hi: Uint<16> = (currentTime >> 16) as Uint<16>;
    const current_lo: Uint<16> = (currentTime & 0xFFFFu64) as Uint<16>;
    
    // Compare high parts first
    if (current_hi > deadline_hi) {
        return true;
    }
    if (current_hi < deadline_hi) {
        return false;
    }
    
    // High parts equal, compare low parts
    return current_lo >= deadline_lo;
}
```

**Trade-off**: Simple to implement, 32-bit range is sufficient for most applications.

---

### Workaround 4: Using Bytes32 for Full Timestamp Storage

**Concept**: If you need the full 64-bit timestamp with no loss of precision, store it as a `Bytes32` type instead of using counters. This gives you 256 bits of storage, far more than enough for any timestamp.

```compact
state fullDeadlineTimestamp: Bytes32;

export circuit storeFullDeadline(
    rawTimestamp: Uint<64>
): [] {
    fullDeadlineTimestamp = rawTimestamp.toBytes();
    return [];
}

export circuit checkFullDeadline(
    currentBlockTime: Uint<64>
): Bool {
    const storedTimestamp = fullDeadlineTimestamp.toUint<64>();
    return blockTimeGte(storedTimestamp);
}
```

**Trade-off**: `Bytes32` storage is more expensive than `Uint<16>`, but it gives you exact timestamp precision. Use this when precision matters more than cost.

---

## Practical Example: Dutch Auction Contract

Let's put this together in a complete contract. A Dutch auction starts at a high price and decreases over time until a buyer is found or the deadline passes.

### Contract Requirements

1. Auction has a `startPrice`, `endPrice`, and `endTime` deadline
2. Price decreases linearly from `startPrice` to `endPrice` over the auction duration
3. Any buyer can bid at the current price before the deadline
4. After the deadline, the auction ends and the highest bidder wins
5. If no bids, the seller can reclaim their item

### Compact Implementation

```compact
// DutchAuction Contract
// A timed auction where price decreases until someone bids or deadline passes

import './types';

// State
state seller: ZswapCoinPublicKey;
state itemId: Uint<128>;
state startPrice: Uint<64>;
state endPrice: Uint<64>;
state endTime_hi: Uint<16>;  // Split timestamp: high bits
state endTime_lo: Uint<16>;  // Split timestamp: low bits
state highestBidder: ZswapCoinPublicKey;
state highestBid: Uint<64>;
state auctionActive: Bool;
state auctionEnded: Bool;

// Initialize auction
export circuit createAuction(
    sellerKey: ZswapCoinPublicKey,
    item: Uint<128>,
    start: Uint<64>,
    end: Uint<64>,
    duration: Uint<64>
): [] {
    seller = sellerKey;
    itemId = item;
    startPrice = start;
    endPrice = end;
    
    // Store deadline using split Hi/Lo pattern
    endTime_hi = (duration >> 16) as Uint<16>;
    endTime_lo = (duration & 0xFFFFu64) as Uint<16>;
    
    auctionActive = true;
    auctionEnded = false;
    highestBid = 0u64;
    
    return [];
}

// Get current auction price (decreases over time)
export circuit getCurrentPrice(
    startTime: Uint<64>,
    currentBlockTime: Uint<64>
): Uint<64> {
    assert(auctionActive, "Auction is not active");
    
    // Calculate elapsed time
    const elapsed = currentBlockTime - startTime;
    const duration = endTime_hi as Uint<64> * 65536u64 + endTime_lo as Uint<64>;
    
    // If past deadline, return end price
    if (elapsed >= duration) {
        return endPrice;
    }
    
    // Linear interpolation: price = start - (start - end) * (elapsed / duration)
    const priceRange = startPrice - endPrice;
    const elapsedFraction = elapsed * 1000u64 / duration;  // Fixed-point math
    const discount = priceRange * elapsedFraction / 1000u64;
    
    return startPrice - discount;
}

// Place a bid
export circuit placeBid(
    bidder: ZswapCoinPublicKey,
    bidAmount: Uint<64>,
    currentBlockTime: Uint<64>
): [] {
    assert(auctionActive, "Auction is not active");
    assert(!auctionEnded, "Auction has already ended");
    
    // Check deadline hasn't passed
    const endTimestamp = endTime_hi as Uint<64> * 65536u64 + endTime_lo as Uint<64>;
    assert(blockTimeLt(endTimestamp), "Auction deadline has passed");
    
    // Verify bid is higher than current highest
    assert(bidAmount > highestBid, "Bid must be higher than current highest");
    
    highestBidder = bidder;
    highestBid = bidAmount;
    
    return [];
}

// End auction (called after deadline)
export circuit endAuction(): [] {
    assert(auctionActive, "Auction is not active");
    assert(!auctionEnded, "Auction has already ended");
    
    // Verify deadline has passed
    // In practice, this would be checked with block time
    // For now, we rely on external verification
    
    auctionActive = false;
    auctionEnded = true;
    
    return [];
}

// Claim winnings (for winner) or reclaim item (for seller if no bids)
export circuit claimWinnings(
    recipient: ZswapCoinPublicKey
): [] {
    assert(auctionEnded, "Auction has not ended yet");
    assert(recipient == highestBidder, "Only winner can claim");
    
    // Transfer item to winner (simplified)
    // In real implementation, this would use sendShielded or token transfer
    
    return [];
}

export circuit reclaimItem(
    sellerKey: ZswapCoinPublicKey
): [] {
    assert(auctionEnded, "Auction has not ended yet");
    assert(sellerKey == seller, "Only seller can reclaim");
    assert(highestBid == 0u64, "Cannot reclaim: item was sold");
    
    // Return item to seller (simplified)
    
    return [];
}
```

### TypeScript Witness Code

```typescript
import type { Witness, Utxo } from '@midnight-ntwrk/midnight-js-types';

// Define the circuit input types to match Compact
interface DutchAuctionWitness {
  // For createAuction
  sellerKey?: Uint8Array;
  item?: bigint;
  startPrice?: bigint;
  endPrice?: bigint;
  startTime?: bigint;
  duration?: bigint;
  
  // For getCurrentPrice
  currentBlockTime?: bigint;
  
  // For placeBid
  bidder?: Uint8Array;
  bidAmount?: bigint;
  
  // For endAuction
  // No additional inputs needed
  
  // For claim/reclaim
  recipient?: Uint8Array;
}

// Convert timestamp to hi/lo split
function timestampToHiLo(timestamp: bigint): { hi: bigint; lo: bigint } {
  return {
    hi: timestamp >> 16n,
    lo: timestamp & 0xFFFFn,
  };
}

// Convert hi/lo split back to timestamp
function hiLoToTimestamp(hi: bigint, lo: bigint): bigint {
  return (hi << 16n) | lo;
}

// Calculate current auction price
function calculateCurrentPrice(
  startPrice: bigint,
  endPrice: bigint,
  startTime: bigint,
  currentTime: bigint,
  duration: bigint
): bigint {
  if (currentTime >= startTime + duration) {
    return endPrice;
  }
  
  const elapsed = currentTime - startTime;
  const priceRange = startPrice - endPrice;
  
  // Use basis points for precision (1/10000)
  const basisPoints = 10000n;
  const elapsedBasis = (elapsed * basisPoints) / duration;
  const discount = (priceRange * elapsedBasis) / basisPoints;
  
  return startPrice - discount;
}

// Example: Creating auction witness
function createAuctionWitness(
  sellerKey: Uint8Array,
  itemId: bigint,
  startPrice: bigint,
  endPrice: bigint,
  durationSeconds: number
): DutchAuctionWitness {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const { hi, lo } = timestampToHiLo(now + BigInt(durationSeconds));
  
  return {
    sellerKey,
    item: itemId,
    startPrice,
    endPrice,
    startTime: now,
    duration: (hi << 16n) | lo,
  };
}

// Example: Placing a bid
function createBidWitness(
  bidderKey: Uint8Array,
  bidAmount: bigint,
  currentBlockTime: bigint
): DutchAuctionWitness {
  return {
    bidder: bidderKey,
    bidAmount,
    currentBlockTime,
  };
}

// Validate bid is above current price
function validateBid(
  bidAmount: bigint,
  startPrice: bigint,
  endPrice: bigint,
  startTime: bigint,
  currentTime: bigint,
  duration: bigint
): boolean {
  const currentPrice = calculateCurrentPrice(
    startPrice,
    endPrice,
    startTime,
    currentTime,
    duration
  );
  
  return bidAmount >= currentPrice;
}
```

---

## Real-World Scenario: Escrow with Timeout and Refund

Let's build a more complete example: an escrow contract where a buyer deposits funds, the seller delivers goods within a deadline, and if the deadline passes without delivery, the buyer gets a refund.

### Contract Logic

1. **Buyer deposits** funds into escrow (stored in contract)
2. **Deadline is set** — seller must deliver within this time
3. **Seller delivers** — signals completion before deadline
4. **If deadline passes** without delivery:
   - Buyer can claim refund
   - Contract releases funds back to buyer
5. **If seller delivers before deadline**:
   - Buyer confirms receipt
   - Contract releases funds to seller

### Escrow Contract

```compact
// EscrowWithTimeout Contract
// Time-sensitive escrow: refund if deadline passes without delivery

import './types';

state buyer: ZswapCoinPublicKey;
state seller: ZswapCoinPublicKey;
state escrowAmount: Uint<64>;
state deadline_hi: Uint<16>;    // Split timestamp for deadline
state deadline_lo: Uint<16>;
state status: Uint<8>;          // 0=pending, 1=delivered, 2=refunded, 3=completed
state depositTime: Uint<64>;    // When funds were deposited

// Create escrow
export circuit createEscrow(
    buyerKey: ZswapCoinPublicKey,
    sellerKey: ZswapCoinPublicKey,
    amount: Uint<64>,
    deadlineSeconds: Uint<64>
): [] {
    buyer = buyerKey;
    seller = sellerKey;
    escrowAmount = amount;
    
    // Store deadline using split Hi/Lo
    deadline_hi = (deadlineSeconds >> 16) as Uint<16>;
    deadline_lo = (deadlineSeconds & 0xFFFFu64) as Uint<16>;
    
    status = 0u8;  // Pending
    depositTime = 0u64;  // Will be set when deposit received
    
    return [];
}

// Record deposit (called after receiveShielded)
export circuit recordDeposit(
    depositTimestamp: Uint<64>
): [] {
    assert(status == 0u8, "Escrow already processed");
    depositTime = depositTimestamp;
    
    return [];
}

// Seller signals delivery
export circuit markDelivered(
    currentBlockTime: Uint<64>
): [] {
    assert(status == 0u8, "Escrow already processed");
    assert(seller != zswapNullKey(), "Only seller can mark delivered");
    
    // Check deadline hasn't passed
    const deadline = deadline_hi as Uint<64> * 65536u64 + deadline_lo as Uint<64>;
    assert(blockTimeLt(deadline), "Deadline has passed, cannot deliver");
    
    status = 1u8;  // Delivered
    
    return [];
}

// Buyer confirms receipt (funds go to seller)
export circuit confirmReceipt(): [] {
    assert(status == 1u8, "Goods not yet delivered");
    
    status = 3u8;  // Completed
    // In real implementation: sendShielded to seller
    
    return [];
}

// Buyer claims refund (deadline passed without delivery)
export circuit claimRefund(
    currentBlockTime: Uint<64>
): [] {
    assert(status == 0u8, "Escrow already processed");
    
    // Check deadline HAS passed
    const deadline = deadline_hi as Uint<64> * 65536u64 + deadline_lo as Uint<64>;
    assert(blockTimeGte(deadline), "Deadline not yet passed");
    
    status = 2u8;  // Refunded
    // In real implementation: sendShielded back to buyer
    
    return [];
}

// Dispute resolution (could be handled by an arbiter)
export circuit resolveDispute(
    winner: ZswapCoinPublicKey,
    _resolver: ZswapCoinPublicKey  // Would verify resolver is authorized
): [] {
    assert(status == 0u8 || status == 1u8, "Cannot dispute resolved escrow");
    
    status = 3u8;  // Completed
    // Funds go to winner
    // In real implementation: sendShielded to winner
    
    return [];
}

// View function: check remaining time
export circuit getRemainingSeconds(
    currentBlockTime: Uint<64>
): Uint<64> {
    const deadline = deadline_hi as Uint<64> * 65536u64 + deadline_lo as Uint<64>;
    
    if (currentBlockTime >= deadline) {
        return 0u64;
    }
    
    return deadline - currentBlockTime;
}

// View function: check if refundable
export circuit isRefundable(
    currentBlockTime: Uint<64>
): Bool {
    if (status != 0u8) {
        return false;
    }
    
    const deadline = deadline_hi as Uint<64> * 65536u64 + deadline_lo as Uint<64>;
    return blockTimeGte(deadline);
}
```

### TypeScript Witness Code

```typescript
interface EscrowWitness {
  // createEscrow
  buyerKey?: Uint8Array;
  sellerKey?: Uint8Array;
  amount?: bigint;
  deadlineSeconds?: bigint;
  
  // recordDeposit
  depositTimestamp?: bigint;
  
  // markDelivered
  currentBlockTime?: bigint;
  
  // confirmReceipt
  // No additional inputs
  
  // claimRefund
  // currentBlockTime (shared with markDelivered)
  
  // resolveDispute
  winner?: Uint8Array;
  resolver?: Uint8Array;
  
  // getRemainingSeconds / isRefundable
  // currentBlockTime (shared)
}

interface EscrowState {
  buyer: Uint8Array;
  seller: Uint8Array;
  escrowAmount: bigint;
  deadline_hi: number;
  deadline_lo: number;
  status: number;
  depositTime: bigint;
}

// Convert deadline to hi/lo
function encodeDeadline(unixTimestamp: bigint): { hi: number; lo: number } {
  return {
    hi: Number(unixTimestamp >> 16n),
    lo: Number(unixTimestamp & 0xFFFFn),
  };
}

// Check if deadline has passed
function isDeadlinePassed(
  deadline_hi: number,
  deadline_lo: number,
  currentTime: bigint
): boolean {
  const deadline = (BigInt(deadline_hi) << 16n) | BigInt(deadline_lo);
  return currentTime >= deadline;
}

// Calculate remaining seconds
function getRemainingSeconds(
  deadline_hi: number,
  deadline_lo: number,
  currentTime: bigint
): bigint {
  const deadline = (BigInt(deadline_hi) << 16n) | BigInt(deadline_lo);
  
  if (currentTime >= deadline) {
    return 0n;
  }
  
  return deadline - currentTime;
}

// Create escrow witness
function createEscrowWitness(
  buyerKey: Uint8Array,
  sellerKey: Uint8Array,
  amount: bigint,
  deadlineHours: number
): EscrowWitness {
  // Deadline is current time + hours
  const deadlineSeconds = BigInt(Math.floor(Date.now() / 1000)) + BigInt(deadlineHours * 3600);
  const encoded = encodeDeadline(deadlineSeconds);
  
  return {
    buyerKey,
    sellerKey,
    amount,
    deadlineSeconds: deadlineSeconds,
  };
}

// Claim refund witness
function createRefundWitness(currentBlockTime: bigint): EscrowWitness {
  return {
    currentBlockTime,
  };
}

// Full escrow state machine validator
function validateEscrowState(state: EscrowState): string[] {
  const errors: string[] = [];
  
  switch (state.status) {
    case 0: // Pending
      // Can still deliver or refund
      break;
    case 1: // Delivered
      // Waiting for buyer confirmation
      break;
    case 2: // Refunded
      // Terminal state
      break;
    case 3: // Completed
      // Terminal state
      break;
    default:
      errors.push(`Invalid status: ${state.status}`);
  }
  
  return errors;
}

// Example: Simulate escrow lifecycle
function simulateEscrowLifecycle() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = now + BigInt(24 * 3600); // 24 hours
  
  console.log('=== Escrow Lifecycle Simulation ===');
  console.log(`Created at: ${now}`);
  console.log(`Deadline: ${deadline}`);
  
  // Check refund eligibility at creation
  console.log(`\nAt creation (t=0): refundable? ${false}`);
  
  // Check after 25 hours
  const later = now + BigInt(25 * 3600);
  const remaining = getRemainingSeconds(
    Number(deadline >> 16n),
    Number(deadline & 0xFFFFn),
    later
  );
  console.log(`\nAfter 25 hours:`);
  console.log(`  Remaining seconds: ${remaining}`);
  console.log(`  Refundable? ${remaining === 0n}`);
}

// Run simulation
simulateEscrowLifecycle();
```

---

## Summary and Key Takeaways

Working with time in Compact requires understanding both the capabilities and constraints of the platform:

1. **Block-time comparisons are comparison-only**: You can't read the raw timestamp; instead, you compare the current block time against stored values using `blockTimeLt`, `blockTimeGte`, `blockTimeEq`, and `blockTimeGt`.

2. **Counters have a Uint<16> ceiling**: Each `increment()` call can add at most 65,535. For larger values, use workarounds.

3. **Four timestamp storage patterns**:
   - **Hours/units division**: Simple but loses precision
   - **Multiple counters**: Full range with hour precision, more complex logic
   - **Hi/Lo splitting**: Good balance of simplicity and range (~4 billion values)
   - **Bytes32**: Maximum precision, higher storage cost

4. **For most applications, the Hi/Lo split pattern is optimal**: It gives you a 32-bit range (sufficient until 2106), is straightforward to implement, and balances complexity with functionality.

5. **Always validate time constraints in witnesses**: Compact enforces deadlines at runtime, but witness code should validate preconditions to provide better error messages and prevent wasted transactions.

For the Dutch auction example, we used the Hi/Lo split pattern to store the end time, combined with `blockTimeLt` to enforce the deadline. For the escrow example, we used the same pattern with `blockTimeGte` to check if the refund window had opened.

Time-based contracts are powerful but require careful planning. Start with the simplest pattern (Hi/Lo splitting) and only move to more complex solutions if you need the precision or range they offer.

---

## Further Reading

- [Midnight Compact Language Documentation](https://docs.midnight.network)
- [Counter Type Reference](https://docs.midnight.network/compact/types#counter)
- [Block Time Functions](https://docs.midnight.network/compact/functions#block-time)
- [Bounty #288: Token Escrow Patterns](../288-accepting-token-deposits/)
- [Bounty #327: Shielded Token Operations](../327-shielded-token-operations/)
