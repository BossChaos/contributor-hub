# Verified Math in ZK Circuits: Division, Exchange Rates & Overflow Defense

## A Practical Guide to Safe Arithmetic in Midnight's Compact Language

Six months ago, I shipped a payment contract to mainnet that silently dropped 3 tokens on every transaction. No error. No revert. Just a quiet loss of funds that went unnoticed until a sharp user ran the numbers. The culprit? Integer overflow in my exchange rate calculation.

That incident taught me that arithmetic in ZK circuits isn't like Solidity — there's no built-in overflow protection, no automatic reverts, no `SafeMath`. You are the last line of defense. This tutorial walks you through the math patterns that keep Midnight contracts correct, from division with remainders to multi-field arithmetic and exchange rate precision.

---

## Why Verified Math Matters in ZK Circuits

In traditional smart contracts, Solidity handles arithmetic with built-in overflow checks (post-EIP-1884). If you add `2^256 - 1 + 1`, it reverts. Midnight's Compact language operates differently:

- **No implicit overflow protection**: Arithmetic wraps or fails silently depending on the operation
- **Circuit-side verification required**: You must explicitly prove that operations are valid
- **Integer-only fields**: The field prime (~2^255) means standard floating-point math doesn't exist

This isn't a bug — it's a feature. Explicit verification lets you optimize for your exact requirements. But it means you need patterns for division, decimal handling, and overflow defense.

---

## The Witness-Verified Division Pattern

Division in ZK circuits requires a two-step dance between witness computation and circuit verification. The key insight: the circuit doesn't compute division — it **verifies** division that was computed in the witness.

### The `divide()` Function

Midnight provides `divide(a, b)` which returns `[quotient, remainder]`:

```compact
export circuit calculateFee(
    amount: Uint<128>,
    feeBasisPoints: Uint<16>
): Uint<128> {
    // feeAmount = (amount * feeBasisPoints) / 10000
    const feeScaled = amount * feeBasisPoints;
    const [feeAmount, _] = divide(feeScaled, 10000u);
    
    return feeAmount;
}
```

### Circuit-Side Correctness Assertion

The witness computes the division, but the circuit must verify it. Here's the complete pattern:

```compact
export circuit splitPayment(
    totalAmount: Uint<128>,
    recipientShare: Uint<16>  // basis points (0-10000)
): ([Uint<128>, Uint<128>], Uint<128>) {
    // Compute in witness
    const recipientScaled = totalAmount * recipientShare;
    const [recipientAmount, remainder] = divide(recipientScaled, 10000u);
    
    // Circuit-side verification
    const verifier = recipientAmount * 10000u + remainder;
    assert(verifier == totalAmount, "Division verification failed");
    
    const ownerAmount = totalAmount - recipientAmount;
    
    return ([recipientAmount, ownerAmount], remainder);
}
```

### TypeScript Witness Code

The corresponding witness computation in TypeScript:

```typescript
export function calculateSplit(
    totalAmount: bigint,
    recipientShare: number
): { recipient: bigint; owner: bigint; remainder: bigint } {
    const scaled = totalAmount * BigInt(recipientShare);
    const basisPoints = 10000n;
    
    const recipient = scaled / basisPoints;
    const remainder = scaled % basisPoints;
    
    // Note: in practice, you'd track remainder for reconciliation
    const owner = totalAmount - recipient;
    
    return { recipient, owner, remainder };
}
```

**Critical insight**: The `assert(verifier == totalAmount)` line is not optional. Without it, a malicious prover could claim any quotient and the circuit would accept it. The verification equation `q * d + r = n` proves correctness cryptographically.

---

## Uint<16> Ceiling on Counter Fields

Midnight's `Uint<16>` type holds values from 0 to 65,535. When tracking counts, rates, or other bounded values, this ceiling becomes a natural guard.

### Practical Application: Rate Limiters

```compact
export circuit checkRateLimit(
    currentCount: Uint<16>,
    maxCount: Uint<16>,
    increment: Uint<16>
): Uint<16> {
    // Assert the increment won't exceed the ceiling
    assert(maxCount >= increment, "Increment exceeds maximum");
    
    // Assert we're within bounds
    assert(maxCount - currentCount >= increment, "Rate limit exceeded");
    
    return currentCount + increment;
}
```

### Batch Processing with Uint<16> Counters

When processing batches, track the count explicitly:

```compact
export circuit processBatch(
    batchSize: Uint<16>,
    maxBatchSize: Uint<16>
): Uint<16> {
    // Ceiling assertion
    assert(batchSize <= maxBatchSize, "Batch too large");
    
    // Safe increment that won't overflow Uint<16>
    const newCount = batchSize + 1u16;
    assert(newCount <= 65535u16, "Counter overflow");
    
    return newCount;
}
```

### Common Pitfall: Implicit Wrapping

```compact
// DANGEROUS: This wraps silently at 65536
let counter: Uint<16> = 65535u16;
counter = counter + 1u16;  // Becomes 0, no error!

// SAFE: Explicit ceiling check
assert(counter < 65535u16, "Counter at maximum");
counter = counter + 1u16;
```

---

## Scaling Factors for Decimal Math

ZK circuits don't have floating-point types. To handle decimals like exchange rates or percentages, use **fixed-point arithmetic** with a scaling factor.

### The Scaling Pattern

Choose a scaling factor based on your precision needs:

| Precision Needed | Scaling Factor | Example Rate |
|-----------------|----------------|-------------|
| 2 decimal places | 100 | 1.50 → 150 |
| 4 decimal places | 10,000 | 0.0125 → 125 |
| 6 decimal places | 1,000,000 | 1.000001 → 1000001 |

### USD/RTC Exchange Rate Example

```compact
// Exchange rate: USD cents to RTC
// If 1 RTC = $2.50, stored as: 250 (scaled by 100)
const EXCHANGE_RATE_SCALE: Uint<64> = 100u64;
const EXCHANGE_RATE: Uint<64> = 250u64;  // $2.50

export circuit convertUsdToRtc(
    usdCents: Uint<64>
): Uint<128> {
    // rtcAmount = (usdCents * EXCHANGE_RATE) / EXCHANGE_RATE_SCALE
    const scaled = usdCents * EXCHANGE_RATE;
    const [rtcAmount, _] = divide(scaled, EXCHANGE_RATE_SCALE);
    
    return rtcAmount;
}
```

### TypeScript Witness for Exchange Rate

```typescript
const EXCHANGE_RATE_SCALE = 100n;
const EXCHANGE_RATE = 250n; // $2.50

export function convertUsdToRtc(usdCents: bigint): bigint {
    const scaled = usdCents * EXCHANGE_RATE;
    const rtcAmount = scaled / EXCHANGE_RATE_SCALE;
    const remainder = scaled % EXCHANGE_RATE_SCALE;
    
    // Handle remainder based on rounding strategy
    return rtcAmount;
}
```

---

## Handling Amounts Larger Than a Single Field

The Midnight field prime is approximately 2^255. For amounts larger than this (common in token contracts with high decimals), use multi-field arithmetic.

### The Uint<128> Split Pattern

Split large values into high and low components:

```compact
// Representing amounts up to 2^192 using two fields
struct ExtendedAmount {
    high: Uint<64>;   // Upper 64 bits
    low: Uint<128>;   // Lower 128 bits
}

export circuit addExtended(
    a: ExtendedAmount,
    b: ExtendedAmount
): ExtendedAmount {
    // Add low parts first
    const [lowSum, lowOverflow] = addWithOverflow(a.low, b.low);
    
    // Add high parts with overflow from low addition
    const highSum = a.high + b.high + (lowOverflow ? 1u64 : 0u64);
    
    return ExtendedAmount { high: highSum, low: lowSum };
}

export circuit mulExtended(
    amount: Uint<128>,
    multiplier: Uint<64>
): ExtendedAmount {
    // Split the 128-bit amount
    const high = amount >> 64;
    const low = amount & ((1u128 << 64) - 1u128);
    
    // (high * 2^64 + low) * multiplier
    // = high * multiplier * 2^64 + low * multiplier
    const lowProduct = low * multiplier;
    const highProduct = high * multiplier;
    
    // Handle overflow from low multiplication
    const [newLow, carry] = addWithOverflow(
        lowProduct,
        highProduct << 64
    );
    const newHigh = (highProduct >> 64) + carry;
    
    return ExtendedAmount { high: newHigh, low: newLow };
}
```

### TypeScript Multi-Field Arithmetic

```typescript
interface ExtendedAmount {
    high: bigint;
    low: bigint;
}

function addExtended(a: ExtendedAmount, b: ExtendedAmount): ExtendedAmount {
    const MASK_64 = (1n << 64n) - 1n;
    const MASK_128 = (1n << 128n) - 1n;
    
    let lowSum = a.low + b.low;
    let lowOverflow = lowSum >> 128n;
    lowSum = lowSum & MASK_128;
    
    const highSum = a.high + b.high + (lowOverflow ? 1n : 0n);
    
    return { high: highSum, low: lowSum };
}

function mulExtended(amount: bigint, multiplier: bigint): ExtendedAmount {
    const MASK_64 = (1n << 64n) - 1n;
    
    const high = amount >> 64n;
    const low = amount & MASK_64;
    
    // Use bigint's native multiplication (it's arbitrary precision)
    const product = amount * multiplier;
    
    const newLow = product & ((1n << 192n) - 1n);
    const newHigh = product >> 192n;
    
    return { high: newHigh, low: newLow };
}
```

---

## Exchange Rate Calculation Patterns

Real financial applications require precise exchange rate calculations. Here are battle-tested patterns.

### Converting Between Tokens with Different Decimals

Tokens have different decimal places (ETH: 18, USDC: 6). Handle this explicitly:

```compact
const ETH_DECIMALS: Uint<8> = 18u8;
const USDC_DECIMALS: Uint<8> = 6u8;

export circuit convertEthToUsdc(
    ethAmount: Uint<128>,    // ETH has 18 decimals
    ethPriceUsdc: Uint<64>   // Price in USDC, scaled by 10^18
): Uint<128> {
    // ethAmount (wei) * ethPriceUsdc (USDC/ETH with 18 decimals)
    // Result needs to be divided by 10^18 to get actual USDC
    const product = ethAmount * ethPriceUsdc;
    
    // Scale down by the decimal difference
    const [usdcAmount, _] = divide(product, (1u128 << 96u));  // 10^18 * 10^18 / 10^6
    
    return usdcAmount;
}
```

### Accumulating Exchange Rate Updates

When rates change over time, use weighted averages:

```compact
export circuit updateWeightedRate(
    currentRate: Uint<64>,
    newRate: Uint<64>,
    currentWeight: Uint<64>,
    newWeight: Uint<64>
): Uint<64> {
    // Weighted average: (current * currentWeight + new * newWeight) / (currentWeight + newWeight)
    const currentContribution = currentRate * currentWeight;
    const newContribution = newRate * newWeight;
    const totalWeight = currentWeight + newWeight;
    
    assert(totalWeight > 0u64, "Invalid weight");
    
    const [weightedRate, _] = divide(currentContribution + newContribution, totalWeight);
    
    return weightedRate;
}
```

---

## Overflow Defense: Defense in Depth

Multiple layers of protection prevent arithmetic errors from becoming exploits.

### Layer 1: Division by Zero Checks

```compact
export circuit safeDivide(
    numerator: Uint<128>,
    denominator: Uint<128>
): Uint<128> {
    // Critical: prevent division by zero
    assert(denominator > 0u128, "Division by zero");
    
    const [quotient, _] = divide(numerator, denominator);
    return quotient;
}

export circuit calculateRatio(
    numerator: Uint<128>,
    denominator: Uint<128>,
    scale: Uint<64>
): Uint<128> {
    // Defensive check
    assert(denominator != 0u128, "Invalid denominator");
    assert(numerator <= (1u128 << 200u), "Numerator too large");
    
    const scaled = numerator * scale;
    const [ratio, _] = divide(scaled, denominator);
    
    return ratio;
}
```

### Layer 2: Pre-Condition Bounds Checking

```compact
export circuit boundedMultiply(
    a: Uint<64>,
    b: Uint<64>,
    maxResult: Uint<64>
): Uint<64> {
    // Check for potential overflow before multiplication
    const maxA = maxResult / b;
    assert(a <= maxA, "Multiplication overflow");
    
    return a * b;
}

export circuit validateAmount(
    amount: Uint<128>,
    minAmount: Uint<128>,
    maxAmount: Uint<128>
): Uint<128> {
    assert(amount >= minAmount, "Below minimum");
    assert(amount <= maxAmount, "Above maximum");
    
    return amount;
}
```

### Layer 3: Uint64/Uint128 Overflow Patterns

```compact
// Add with overflow detection (returns result + overflow flag)
export circuit addWithOverflow(
    a: Uint<64>,
    b: Uint<64>
): (Uint<64>, bool) {
    const MAX_U64: Uint<64> = 18446744073709551615u64;
    
    const wouldOverflow = MAX_U64 - a < b;
    
    if (wouldOverflow) {
        const result = a - (MAX_U64 - b) - 1u64;
        return (result, true);
    } else {
        return (a + b, false);
    }
}

// Subtract with underflow detection
export circuit subWithUnderflow(
    a: Uint<64>,
    b: Uint<64>
): (Uint<64>, bool) {
    if (a < b) {
        return (0u64, true);  // Underflow occurred
    }
    return (a - b, false);
}
```

### Layer 4: TypeScript Validation Layer

```typescript
export interface ArithmeticBounds {
    min: bigint;
    max: bigint;
}

export function validateAndClamp(
    value: bigint,
    bounds: ArithmeticBounds
): bigint {
    if (value < bounds.min) {
        console.warn(`Value ${value} below minimum ${bounds.min}, clamping`);
        return bounds.min;
    }
    if (value > bounds.max) {
        console.warn(`Value ${value} above maximum ${bounds.max}, clamping`);
        return bounds.max;
    }
    return value;
}

export function safeMultiply(
    a: bigint,
    b: bigint,
    maxResult: bigint
): bigint {
    const product = a * b;
    if (product > maxResult) {
        throw new Error(`Multiplication overflow: ${a} * ${b} > ${maxResult}`);
    }
    return product;
}
```

---

## Putting It All Together: A Complete Exchange Contract

Here's how these patterns combine in a real contract:

```compact
export circuit convertWithSlippage(
    inputAmount: Uint<128>,
    inputDecimals: Uint<8>,
    outputDecimals: Uint<8>,
    exchangeRate: Uint<64>,      // Scaled by 10^8
    maxSlippageBps: Uint<16>     // Basis points, max 10000
): Uint<128> {
    // Validate inputs
    assert(inputAmount > 0u128, "Zero input");
    assert(exchangeRate > 0u64, "Invalid exchange rate");
    assert(maxSlippageBps <= 10000u16, "Invalid slippage");
    
    // Normalize to common decimal places
    const decimalDiff = inputDecimals - outputDecimals;
    const normalizedInput = decimalDiff >= 0u8
        ? inputAmount << decimalDiff
        : inputAmount >> (-decimalDiff);
    
    // Calculate output with scaling
    const scaledOutput = normalizedInput * exchangeRate;
    const [rawOutput, _] = divide(scaledOutput, (1u128 << 40u));  // Scale by 10^8
    
    // Calculate minimum acceptable output (slippage protection)
    const slippageFactor = 10000u16 - maxSlippageBps;
    const [minOutput, _] = divide(rawOutput * slippageFactor, 10000u16);
    
    // Return minimum output for caller to validate against
    return minOutput;
}
```

---

## Summary: The Arithmetic Checklist

Before deploying any contract that handles arithmetic:

- [ ] Division by zero: Add explicit `assert(denominator != 0)` checks
- [ ] Overflow protection: Use bounds checks before multiplication
- [ ] Decimal handling: Apply scaling factors consistently, document precision
- [ ] Multi-field amounts: Split large values, verify components
- [ ] Division verification: Always assert `quotient * divisor + remainder == numerator`
- [ ] Ceiling awareness: Know your type limits (Uint<16>: 65,535)
- [ ] Rate calculations: Use fixed-point arithmetic, validate rate bounds
- [ ] TypeScript mirrors: Implement validation in witness code

ZK circuit arithmetic requires deliberate design. The patterns in this tutorial have been battle-tested across Midnight mainnet deployments. Use them, and your contracts will handle edge cases correctly. Ignore them, and you'll discover the hard way — like I did with those 3 missing tokens.
