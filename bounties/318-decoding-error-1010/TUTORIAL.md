# Decoding Error 1010: What 'Invalid Transaction' Actually Means

If you have ever submitted a transaction to the Midnight network and been greeted by an opaque **Error 1010: Invalid Transaction**, you are not alone. This error is one of the most common — and most misunderstood — failures developers encounter. On the surface it tells you almost nothing. Under the hood, however, it encodes a precise diagnostic message that, once decoded, points directly to the root cause.

This tutorial will teach you how to read these error codes, map them to their specific failure modes, and follow a systematic diagnostic process to get your transactions accepted.

---

## 1. The Anatomy of a Midnight Transaction Error Code

Midnight is built on the **Polkadot SDK**, and it inherits the transaction pool's error numbering convention. Every transaction that fails validation in the pool returns an error code constructed from two parts:

```
Error Code = AUTHOR_BASE + VARIANT_INDEX
```

- **`AUTHOR_BASE`** identifies the *subsystem* that rejected the transaction. For pool-level rejections, this is `1000` (often denoted `AUTHOR(1000)` in source code).
- **`VARIANT_INDEX`** is the specific error variant within that subsystem.

So **Error 1010** means:

```
1010 = AUTHOR(1000) + 10 → InvalidTransaction
```

The `InvalidTransaction` enum defines roughly a dozen distinct rejection reasons, each with its own variant index. The full error message you see in your dApp or CLI is the top-level 1010; the *actual cause* lives in the inner variant (accessible through detailed logs, node output, or the transaction builder's error chain).

---

## 2. Understanding the Transaction Validation Pipeline

To diagnose errors effectively, you need to know **where** in the pipeline a transaction can fail. A Midnight transaction passes through four phases before it lands in a block:

```
Construction → Balancing → Signing → Submission → Pool Validation → Block Execution
```

**Error 1010 occurs at the Pool Validation stage.** The transaction pool (`txpool`) checks every incoming transaction for *well-formedness* before it is even considered for inclusion. This includes structural integrity, cryptographic validity, resource availability, and ledger-level constraints.

If any of these checks fail, the pool rejects the transaction with `InvalidTransaction` and a specific variant. Critically, **the transaction never reaches the block executor** — it is dropped at the gate.

---

## 3. Common Error Variants and What They Mean

Below we map the most frequently encountered variant codes to their meanings, typical causes, and diagnostic steps.

### Error Code 139: Transaction Builder — `MalformedTransaction`

**What it means:** The transaction builder could not construct a valid transaction. This is a **client-side** error that surfaces before the transaction even reaches the node.

**Typical causes:**
- Missing or incorrectly structured ZK proof data.
- A contract call with arguments that do not match the circuit's expected types.
- Unbalanced token amounts (inputs ≠ outputs for one or more segments).
- Invalid nonce or TTL values.

**How to diagnose:**
1. Check the transaction builder's error output — the error chain will usually include the specific field that failed.
2. Use the Midnight MCP to simulate the transaction before submission:
   ```typescript
   const result = await midnightMcp.simulateTransaction(tx);
   console.log(result.diagnostics);
   ```
3. If you are working with Compact contracts, verify that your circuit arguments match the compiled ABI. Run `compactc` with the `--check` flag to validate your contract before generating the transaction.

**Quick fix:** Rebuild the transaction from scratch, logging each step. The builder will fail at the first malformed component — that log line is your starting point.

---

### Error Code 154: `BlockLimitExceeded`

**What it means:** The transaction's resource consumption exceeds the **block-level limits** set by the ledger's cost model. This is not about fees — it is about hard execution boundaries.

Midnight does not optimize for gas cost; it enforces hard limits. If your transaction needs more compute time, I/O, or storage than a single block allows, it is rejected outright.

**The 5-dimensional cost model:**

| Dimension | What It Measures | Typical Limit |
|---|---|---|
| **Compute Time** | Single-threaded CPU execution time | ~1 second per block |
| **I/O Read Time** | Storage read operations (random access) | ~1 second per block |
| **Consensus Throughput** | Transaction data size (block payload) | ~200 KB per block |
| **Persistent Storage** | Net new bytes written to state | ~20 KB per block |
| **Churn** | Temporary storage (written then deleted) | ~1 MB per block |

A transaction is evaluated against *all five* dimensions simultaneously. If it exceeds **any single dimension**, it is rejected with `BlockLimitExceeded`.

**Typical causes:**
- A contract that performs heavy computation on-chain (e.g., iterating over a large dataset, computing complex arithmetic in-circuit).
- Reading or writing large structs from the ledger — each `lookup()` pulls the *entire* struct into the circuit.
- Too many state writes in a single transaction.

**How to diagnose:**
1. Profile your contract's resource usage. The ledger's `generate-cost-model` utility can benchmark individual operations.
2. Check which dimension you are hitting. Node logs will typically indicate the limiting resource.
3. If compute time is the bottleneck, consider moving computation off-chain and submitting only the proof + result on-chain.

**Quick fix:** Restructure your contract to minimize on-chain work. Replace complex struct maps with flat key-value maps. Move heavy computation off-chain and use Merkle proofs for verification. A common pattern is:
   - On-chain: store only the Merkle root and a minimal claim status.
   - Off-chain: compute rewards, build the tree, generate proofs.
   - On-chain claim: verify the proof in a few steps.

---

### Error Code 168: Batch Settlement Failure

**What it means:** A transaction that involves **batch operations** — such as multiple contract calls across segments, or batched ZSwap offers — failed during the settlement phase. This typically happens when the causal precedence ordering between segments is violated.

Midnight transactions can contain multiple **segments** (identified by `segment_id`), each with guaranteed and fallible parts. The ledger enforces a strict causal order: if segment `a` and segment `b` call the same contract and `a < b`, then either `a` must have no fallible transcript, or `b` must have no guaranteed transcript.

**Typical causes:**
- Two segments trying to modify the same contract state in an order that creates a cycle.
- A fallible segment depending on the outcome of a later guaranteed segment.
- Batch ZSwap offers with overlapping inputs across segments.

**How to diagnose:**
1. Review your segment ordering. Ensure that guaranteed sections (`segment_id = 0`) do not conflict with fallible sections in the same intent.
2. Check for overlapping nullifiers or inputs across ZSwap offers in different segments.
3. Use the transaction builder's validation output to identify which segment pair is in conflict.

**Quick fix:** Simplify your transaction to a single segment if possible. If you need multiple segments, ensure each segment operates on independent contract state or ZSwap inputs.

---

### Error Code 170: Merkle Root Pruning

**What it means:** The transaction references a **Merkle root** that the ledger can no longer resolve. This happens when the root corresponds to a state that has been pruned from the node's storage.

Midnight nodes maintain a finite window of historical state. When a Merkle root falls outside this window (determined by the `BlockHashCount` parameter), the node can no longer verify proofs anchored to that root.

**Typical causes:**
- Using a stale Merkle root that was generated many blocks ago.
- A proof generated against an old snapshot of the shielded pool state.
- Submitting a transaction long after the referenced state was created.

**How to diagnose:**
1. Check the age of the Merkle root your transaction references. Compare the root's block height against the node's `BlockHashCount` (typically 2400 blocks).
2. If `current_block - root_block > BlockHashCount`, the root has been pruned.
3. Regenerate your proof against the current state.

**Quick fix:** Always generate ZK proofs immediately before submission. Do not cache proofs for extended periods. If your workflow requires pre-generated proofs, implement a TTL check and regenerate if the root is approaching the pruning window.

---

### Error Code 186: `EffectsCheckFailure`

**What it means:** The transaction's **effects mapping** failed validation. This is one of the most subtle and hardest-to-diagnose errors, as it occurs during the ledger's holistic consistency check.

When a transaction is applied, the ledger verifies that every action produces a well-defined, non-conflicting effect on the state. Specifically, it checks:
- **Disjoint inputs/outputs:** No overlap between shielded and unshielded inputs/outputs across all offers.
- **Sequencing:** The causal precedence partial order is satisfied.
- **Balancing:** Per-segment token balances are non-negative.
- **Pedersen commitments:** All commitments open correctly to the declared balances.
- **Effect mapping:** There is a bidirectional 1:1 mapping between contract calls, nullifiers, shielded spends/receives, and unshielded spends.

If any of these checks fail, the entire transaction is rejected.

**Typical causes:**
- A contract call that consumes a nullifier already consumed by a ZSwap offer in the same transaction.
- Mismatched Pedersen commitments — the binding randomness does not correctly commit to the actual token flows.
- An unbalanced segment (outputs exceed inputs for a token type).
- A nullifier collision (double-spend attempt).

**How to diagnose:**
1. Enable verbose logging in the node (`RUST_LOG=ledger=debug`). The effects check will log which specific validation failed.
2. Run the transaction through the ledger's `well_formed` check locally:
   ```rust
   let result = tx.well_formed(tblock, ref_state);
   // This will tell you exactly which check failed
   ```
3. If you are using the Midnight MCP, the simulation response will include the effects validation result.

**Quick fix:** Isolate the failing check by removing components one at a time. Start with a minimal valid transaction (e.g., a simple ZSwap) and add components back until the error reappears. The last component added is your culprit.

---

## 4. The Systematic Diagnostic Workflow

When you encounter Error 1010, follow this workflow:

### Step 1: Identify the Variant

The raw error code 1010 tells you "something is wrong." You need the **inner variant** to know what.

- **In the dApp connector:** The `ErrorCodes` object provides variant names.
- **In node logs:** Look for `InvalidTransaction(VariantName)` in the log output.
- **Via MCP:** The simulation response includes the detailed error chain.

### Step 2: Map to the Validation Stage

| Variant | Stage | Client or Server? |
|---|---|---|
| 139 (Builder) | Construction | Client |
| 154 (Limits) | Pool Validation | Server |
| 168 (Batch) | Pool Validation | Server |
| 170 (Pruning) | Pool Validation | Server |
| 186 (Effects) | Pool Validation | Server |

Client-side errors (139) are fixed in your code. Server-side errors require adjusting the transaction's structure or timing.

### Step 3: Apply the Specific Fix

Refer to the diagnostic steps above for your specific variant.

### Step 4: Verify with Simulation

Before resubmitting, always simulate:

```typescript
// Using the Midnight MCP
const simulation = await midnightMcp.simulateTransaction(tx);
if (simulation.valid) {
  console.log("Transaction is well-formed. Safe to submit.");
} else {
  console.log("Simulation failed:", simulation.errors);
}
```

---

## 5. Understanding the Ledger Cost Model in Depth

The cost model is central to understanding why some transactions are rejected while others succeed. Let us break it down.

### Why Five Dimensions?

Traditional blockchains use a single "gas" metric that conflates compute, storage, and bandwidth. This creates perverse incentives: a transaction that is compute-heavy but storage-light might be priced the same as one that is storage-heavy but compute-light, even though they stress different system resources.

Midnight's five-dimensional model separates these concerns:

1. **Compute Time** — ensures no single transaction monopolizes the CPU.
2. **I/O Read Time** — prevents storage thrashing from random access patterns.
3. **Consensus Throughput** — limits the data that must propagate across the network.
4. **Persistent Storage** — controls long-term state growth (the most expensive resource).
5. **Churn** — tracks temporary state changes that consume disk I/O without lasting value.

### How Fees Are Calculated

The fee for a transaction is computed as:

```
fee = max(read_cost, compute_cost, block_cost) + write_cost + churn_cost
```

Note that the three "utilization" dimensions (read, compute, block usage) are combined with **`max()`**, not summed. This means a transaction that is balanced across all three dimensions pays less than one that heavily stresses a single dimension. Storage costs are added independently.

### Dynamic Pricing

The ledger adjusts prices per dimension based on utilization, targeting 50% fullness for each. When a dimension is congested, its price increases. This creates a natural feedback loop: users are incentivized to optimize their transactions for the currently cheapest dimension.

### Practical Implications for Developers

- **Minimize state reads.** Every `lookup()` costs I/O read time. Cache values off-chain when possible.
- **Keep transactions small.** Consensus throughput is limited — large proofs or many contract calls will hit this limit.
- **Avoid churn.** Writing and then immediately deleting state costs you in the churn dimension for no benefit.
- **Profile before deploying.** Use the `generate-cost-model` benchmark suite to measure your contract's cost profile.

---

## 6. Pro Tips: Avoiding Error 1010 Before It Happens

1. **Always simulate first.** The Midnight MCP's `simulateTransaction` is your best friend. It runs the full `well_formed` check without submitting to the network.
2. **Generate proofs fresh.** Do not cache ZK proofs. Merkle roots get pruned, and stale proofs will trigger Error 170.
3. **Keep contracts minimal.** The constraint-based execution model rewards simplicity. Every additional state read, write, or computation pushes you closer to `BlockLimitExceeded`.
4. **Test with realistic data.** A transaction that works with one element in a map may fail with a hundred. Test with the scale you expect in production.
5. **Monitor node logs.** If you are running your own node, set `RUST_LOG=ledger=debug` and `RUST_LOG=txpool=debug`. The logs will tell you exactly which validation failed and why.

---

## Summary

Error 1010 is not a single error — it is an **error category** that contains a dozen specific failure modes. By decoding the inner variant, understanding the validation pipeline, and following a systematic diagnostic workflow, you can quickly identify and resolve the root cause.

The key takeaway: Midnight does not charge more for complexity — it **refuses** transactions that exceed its limits. This constraint-based model requires a different mindset than EVM-style gas optimization, but it leads to more predictable costs and better network stability.

Master these diagnostics, and Error 1010 becomes not a roadblock, but a precise guide to improving your transactions.

---

*For further reading, see the [Midnight Ledger Specification](https://github.com/midnightntwrk/midnight-ledger/tree/ledger-8/spec) and the [Midnight Developer Documentation](https://docs.midnight.network/getting-started).*
