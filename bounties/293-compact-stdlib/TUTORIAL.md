# Compact Standard Library: A Practical Guide to Every Export

The Compact standard library ships with every Midnight project — you don't install it, you don't import a package manager dependency. It's just there, baked into the compiler. But the official docs are sparse enough that most developers only discover what's available by reading other people's contracts or stumbling into a type error.

This guide fixes that. I'll walk through every meaningful export, grouped by what it actually does, with working code examples you can compile and test. The companion repository at [github.com/your-username/compact-stdlib-guide](https://github.com/your-username/compact-stdlib-guide) contains all the contracts as individual `.compact` files, ready to compile with `compactc`.

If you've been writing Compact contracts and keep wondering "is there a built-in way to do this?", the answer is probably in here.

---

## Generic Types: Maybe and Either

These two show up in nearly every non-trivial contract. If you've written TypeScript or Rust, the concepts are familiar — but the ZK context adds some nuances that matter.

### Maybe\<T\>

`Maybe<T>` represents an optional value: either `Some(value)` or `None`. No nulls, no sentinel values like `0` or `-1` pretending to mean "not set."

```compact
contract MaybeExample {
  ledger admin: Maybe<ContractAddress>;
  ledger config: Maybe<Uint<64>>;

  circuit setAdmin(addr: ContractAddress): [] {
    assert ledger.admin.isNone : "admin already set";
    ledger.admin = Maybe.some(addr);
  }

  circuit clearAdmin(): [] {
    assert ledger.admin.isSome : "no admin to clear";
    ledger.admin = Maybe.none();
  }

  circuit isAdmin(addr: ContractAddress): [Boolean] {
    const current = ledger.admin;
    return [current.isSome && current.value == addr];
  }
}
```

The key properties:

- **`.isSome`** — Boolean, `true` if the value exists
- **`.isNone`** — Boolean, `true` if the value is absent
- **`.value`** — The inner value of type `T`, but **only safe to access when you know it's `Some`**

Here's the critical gotcha: accessing `.value` on a `None` inside a ZK circuit doesn't throw an exception — it makes the proof impossible to generate. The constraint solver hits an unsatisfiable condition and fails silently. Always gate `.value` access behind an `.isSome` check.

A common pattern is lazy initialization:

```compact
circuit initConfig(value: Uint<64>): [] {
  if ledger.config.isNone {
    ledger.config = Maybe.some(value);
  }
}
```

### Either\<L, R\>

`Either<L, R>` is a tagged union — one of two possible types, `Left(L)` or `Right(R)`. By convention, `Left` carries error information and `Right` carries success values. Compact doesn't enforce this convention, but following it makes your code readable.

```compact
contract EitherDemo {
  circuit safeDivide(
    witness dividend: Uint<64>,
    witness divisor: Uint<64>
  ): [Either<Bytes<32>, Uint<64>>] {
    if divisor == Uint<64>::from(0) {
      return [Either.left(bytes("division by zero"))];
    }
    return [Either.right(dividend / divisor)];
  }

  circuit processResult(
    witness a: Uint<64>,
    witness b: Uint<64>
  ): [Boolean, Uint<64>] {
    const result = EitherDemo::safeDivide(a, b);
    if result.isLeft {
      return [false, Uint<64>::from(0)];
    }
    return [true, result.rightValue];
  }
}
```

Discriminate with `.isLeft`, `.isRight`, `.leftValue`, and `.rightValue`. Same caveat as `Maybe` — accessing the wrong branch causes a constraint failure, not a recoverable error.

`Either` is less common than `Maybe` in practice but becomes essential when circuits need to communicate structured error information to callers.

---

## Merkle Trees and Commitments

Merkle trees are the backbone of ZK contract design. The standard library gives you the tree type itself plus the commitment and verification primitives you need for privacy-preserving state proofs.

### MerkleTree\<N, T\>

`MerkleTree<N, T>` is a complete binary Merkle tree with `N` levels — meaning `2^N` leaves — holding values of type `T`. The size is fixed at compile time.

```compact
contract MerkleRegistry {
  export ledger members: MerkleTree<20, Bytes<32>>;
  export ledger memberCount: Uint<64>;

  circuit addMember(commitment: Bytes<32>): [Uint<64>] {
    const index = ledger.memberCount;
    ledger.members.set(index, commitment);
    ledger.memberCount = index + Uint<64>::from(1);
    return [index];
  }
}
```

Plan your tree depth early. `N=16` gives you 65,536 entries (fine for small registries). `N=20` gives you ~1 million (good for most production use cases). `N=32` gives you 4 billion (overkill unless you're building something at scale).

The tree supports `.root()` to get the current root hash and `.set(index, value)` to update a leaf. You can verify membership with `verifyMerkleProof(leaf, root, pathElements, pathIndices)` — this is how you prove someone is in the registry without revealing who else is.

### persistentCommit

`persistentCommit(witness: Bytes<32>)` creates a commitment anchored to Midnight's state tree. It's deterministic — the same secret always produces the same commitment — and it's tied to a specific epoch, enabling "this value existed at this point in time" proofs.

```compact
circuit commit(witness secret: Bytes<32>): [Bytes<32>] {
  const commitment = persistentCommit(secret);
  ledger.commitments.set(index, commitment);
  return [commitment];
}
```

This is the foundation of commit-reveal patterns. Commit on-chain now, reveal off-chain later when you're ready.

### verifyCommitment

The counterpart to `persistentCommit`: given a secret and a commitment, verify they match.

```compact
circuit reveal(
  witness secret: Bytes<32>,
  public commitment: Bytes<32>
): [Boolean] {
  return [verifyCommitment(secret, commitment)];
}
```

Together, `persistentCommit` and `verifyCommitment` power sealed-bid auctions, private voting, and nullifier-based replay prevention. The commit phase hides the value; the reveal phase proves it was committed earlier.

---

## Elliptic Curves

Midnight's ZK circuits operate over elliptic curves under the hood. The standard library surfaces some of this for contracts that need explicit cryptographic operations.

### CurvePoint

`CurvePoint` represents a point on Midnight's elliptic curve. You interact with these when doing key derivation, signature verification, or building custom commitment schemes.

```compact
circuit derivePublicKey(
  witness privateKey: Scalar
): [CurvePoint] {
  const G = CurvePoint.generator();
  return [G.multiply(privateKey)];
}
```

Operations:

- **`.generator()`** — Static method, returns the base point `G`
- **`.multiply(scalar)`** — Scalar multiplication (expensive in ZK)
- **`.add(other)`** — Point addition (cheaper)
- **`.negate()`** — Point negation
- **`.hashToCurve(bytes)`** — Hash arbitrary data to a curve point

All operations generate ZK constraints. `multiply` is the most expensive — use it only when the scalar is a private witness.

### Scalar

`Scalar` is a field element in the elliptic curve's scalar field. It's what you use for private keys, blinding factors, and random nonces.

```compact
circuit pedersenCommit(
  witness value: Uint<64>,
  witness blinding: Scalar
): [CurvePoint] {
  const H = CurvePoint.hashToCurve(bytes("value"));
  const G = CurvePoint.generator();
  return [H.multiply(Scalar.fromUint(value)).add(G.multiply(blinding))];
}
```

The Pedersen commitment pattern above is worth knowing: it commits to a value while keeping it hidden, and the commitments are additively homomorphic — you can add two commitments to get a commitment to the sum.

---

## Kernel Types

These types bridge the ZK contract world and Midnight's transaction kernel. They're how your contract talks about identity, addresses, and shielded coin state.

### ContractAddress

`ContractAddress` is the canonical identity for smart contracts. It's derived from the contract's code hash and deployment parameters — deterministic and unique.

```compact
contract AccessControlled {
  export ledger admin: ContractAddress;

  circuit initialize(adminAddr: ContractAddress): [] {
    assert ledger.admin == ContractAddress.zero() : "already initialized";
    ledger.admin = adminAddr;
  }

  circuit adminAction(): [] {
    assert ledger.admin == ContractAddress.self() : "unauthorized";
  }
}
```

Key methods:

- **`.zero()`** — Returns the zero address (the default/unset value)
- **`.self()`** — Returns this contract's own address

Use `ContractAddress` for identity-based access control. Never use `ownPublicKey()` for this purpose — the public key can be spoofed in certain attack scenarios, while the contract address is derived from verifiable on-chain data.

### ZswapCoinPublicKey

`ZswapCoinPublicKey` is the public key type for Zswap coin ownership — Midnight's shielded asset system. When users deposit shielded tokens, you store their `ZswapCoinPublicKey` to represent who has claim to those coins.

```compact
ledger depositor: ZswapCoinPublicKey;

circuit recordDepositor(pk: ZswapCoinPublicKey): [] {
  ledger.depositor = pk;
}
```

This type is opaque. You can store it, compare it, and pass it to shielded transfer functions, but you can't decompose it into underlying curve points without dropping to the lower-level elliptic curve API.

### UserAddress

`UserAddress` is a higher-level address type that wraps both a `ZswapCoinPublicKey` and a spending key derivation path. It's what users expose publicly when they want to receive funds.

```compact
circuit getRecipientKey(userAddr: UserAddress): [ZswapCoinPublicKey] {
  return [userAddr.spendingKey()];
}
```

Think of `UserAddress` as the "public address you share" and `ZswapCoinPublicKey` as the "internal representation for coin operations." They're related but not interchangeable.

### ShieldedCoinInfo

`ShieldedCoinInfo` describes a shielded coin: its value, token type, and randomness.

```compact
circuit inspectCoin(coinInfo: ShieldedCoinInfo): [Uint<64>, Bytes<32>] {
  return [coinInfo.value, coinInfo.tokenType];
}
```

You rarely construct these manually — they come from `receiveShielded` and get consumed by `sendShielded`. But knowing the structure helps when routing coins based on value or type.

### QualifiedShieldedCoinInfo

`QualifiedShieldedCoinInfo` extends `ShieldedCoinInfo` with the nullifier key needed to spend the coin. This is what `receiveShielded` returns.

```compact
circuit deposit(witness coinProof: CoinProof): [QualifiedShieldedCoinInfo] {
  const coin = receiveShielded(coinProof);
  // coin.info.value — the amount
  // coin.info.tokenType — which token
  // coin.nullifierKey — needed to spend later
  return [coin];
}
```

### CoinProof

`CoinProof` is the ZK proof that demonstrates ownership of a shielded coin without revealing the coin's details. It's a witness-type input to `receiveShielded`.

---

## Helper Circuits

These are the high-level operations for working with tokens and shielded transfers. They're the most practically useful exports for contracts that handle value.

### nativeToken()

Returns the token type identifier for MNT, Midnight's native token. It's a `Bytes<32>` constant.

```compact
circuit acceptMNTOnly(coinType: Bytes<32>): [] {
  assert coinType == nativeToken() : "only MNT accepted";
}
```

Don't hardcode the native token bytes. Use this function so your contract works correctly across testnet and mainnet where the token identifier might differ.

### tokenType(ContractAddress)

Derives the token type identifier for a custom token contract. Every token on Midnight is identified by the contract that minted it.

```compact
circuit isMyToken(coinType: Bytes<32>): [Boolean] {
  return [coinType == tokenType(ContractAddress.self())];
}
```

If you're building a multi-token vault or DEX, you'll use this to route coins to the correct handling logic.

### evolveNonce

`evolveNonce(nonce: Bytes<32>)` advances a nonce to prevent replay attacks. Each operation produces a new nonce for the next one.

```compact
circuit useNonce(witness action: Bytes<32>): [Bytes<32>] {
  const nonce = ledger.currentNonce;
  const nextNonce = evolveNonce(nonce);
  ledger.currentNonce = nextNonce;
  assert verifyCommitment(action, nonce) : "invalid nonce";
  return [nextNonce];
}
```

This is the recommended pattern over static nonces. Each use chains to the next, making replayed actions invalid because the nonce has already advanced.

### shieldedBurnAddress()

Returns the canonical burn address for Midnight. Tokens sent here are permanently removed from circulation.

```compact
circuit burn(amount: Uint<64>): [] {
  sendShielded(shieldedBurnAddress(), amount);
}
```

The burn address is a well-known constant — everyone can compute it, but nobody can spend from it. Use it for token burns, fee collection, or any mechanism where tokens should be destroyed.

---

## Shielded Token Operations

These are the core functions for moving shielded value in and out of contracts. They're what make Midnight's privacy model work at the contract level.

### receiveShielded

`receiveShielded(coinProof: CoinProof)` processes an incoming shielded coin transfer. It validates the ZK proof, extracts the coin information, and returns a `QualifiedShieldedCoinInfo`.

```compact
circuit deposit(witness coinProof: CoinProof): [QualifiedShieldedCoinInfo] {
  const coin = receiveShielded(coinProof);
  assert coin.info.tokenType == nativeToken() : "MNT only";
  ledger.balance = ledger.balance + coin.info.value;
  return [coin];
}
```

The `coinProof` is a private witness — the depositor provides it off-chain, and the circuit verifies it without revealing the coin's details to public observers.

### sendShielded

`sendShielded(recipient: ZswapCoinPublicKey, coin: QualifiedShieldedCoinInfo, amount: Uint<64>)` constructs and sends a shielded transfer.

```compact
circuit withdraw(
  recipient: ZswapCoinPublicKey,
  amount: Uint<64>
): [] {
  assert amount <= ledger.balance : "insufficient balance";
  ledger.balance = ledger.balance - amount;
  sendShielded(recipient, ledger.heldCoin, amount);
}
```

What's visible on-chain: the transfer happened and the contract's ledger state changed. What stays private: the amount, the recipient's identity, and the coin's lineage.

---

## Block-Time Queries

Midnight exposes time and epoch information to contracts through three functions.

### getBlockTime()

Returns the current block timestamp as a `Uint<64>` (Unix epoch seconds).

### getBlockNumber()

Returns the current block height as a `Uint<64>`.

### getEpoch()

Returns the current epoch number as a `Uint<64>`. Epochs are Midnight's consensus time periods.

```compact
contract TimeEscrow {
  export ledger unlockBlock: Uint<64>;
  export ledger locked: Boolean;

  circuit lock(duration: Uint<64>): [] {
    assert !ledger.locked : "already locked";
    ledger.unlockBlock = getBlockNumber() + duration;
    ledger.locked = true;
  }

  circuit release(): [] {
    assert getBlockNumber() >= ledger.unlockBlock : "still locked";
    ledger.locked = false;
  }
}
```

Use `getBlockNumber()` for relative timing (lock for N blocks), `getBlockTime()` for absolute deadlines (unlock after a specific timestamp), and `getEpoch()` for rate-limiting or epoch-based voting.

---

## Putting It All Together: A Token Vault

Here's a minimal but complete contract that uses several stdlib exports together:

```compact
pragma language_version >= 0.22;

contract TokenVault {
  export ledger deposits: MerkleTree<16, Bytes<32>>;
  export ledger depositCount: Uint<64>;
  export ledger totalBalance: Uint<64>;
  export ledger heldCoins: MerkleTree<16, QualifiedShieldedCoinInfo>;

  circuit deposit(witness coinProof: CoinProof): [Uint<64>] {
    const coin = receiveShielded(coinProof);
    assert coin.info.tokenType == nativeToken() : "MNT only";

    const index = ledger.depositCount;
    ledger.heldCoins.set(index, coin);
    ledger.totalBalance = ledger.totalBalance + coin.info.value;
    ledger.depositCount = index + Uint<64>::from(1);

    const commitment = persistentCommit(
      coin.info.value.toBytes().concat(index.toBytes())
    );
    ledger.deposits.set(index, commitment);

    return [index];
  }

  circuit withdraw(
    coinIndex: Uint<64>,
    recipient: ZswapCoinPublicKey
  ): [] {
    const coin = ledger.heldCoins.get(coinIndex);
    assert coin.isSome : "coin not found";
    ledger.totalBalance = ledger.totalBalance - coin.value.info.value;
    sendShielded(recipient, coin.value, coin.value.info.value);
    ledger.heldCoins.set(coinIndex, Maybe.none());
  }
}
```

This vault accepts shielded MNT deposits, tracks them in a Merkle tree, creates verifiable commitments for each deposit, and allows withdrawals to any shielded address. It demonstrates `Maybe`, `MerkleTree`, `persistentCommit`, `nativeToken`, `receiveShielded`, `sendShielded`, and `QualifiedShieldedCoinInfo` all in one contract.

---

## Quick Reference

| Export | Category | Purpose |
|--------|----------|---------|
| `Maybe<T>` | Generic | Optional values, nullable ledger fields |
| `Either<L, R>` | Generic | Two-outcome results, structured errors |
| `MerkleTree<N, T>` | Merkle | Fixed-size on-chain indexed storage |
| `persistentCommit` | Merkle | Creating verifiable commitments |
| `verifyCommitment` | Merkle | Verifying commitments in proofs |
| `verifyMerkleProof` | Merkle | Proving leaf membership in a tree |
| `CurvePoint` | Crypto | Key derivation, Pedersen commitments |
| `Scalar` | Crypto | Private keys, blinding factors |
| `ContractAddress` | Kernel | Contract identity, access control |
| `ZswapCoinPublicKey` | Kernel | Shielded coin recipient keys |
| `UserAddress` | Kernel | User-facing addresses |
| `ShieldedCoinInfo` | Kernel | Coin value/type metadata |
| `QualifiedShieldedCoinInfo` | Kernel | Spendable coin with nullifier key |
| `CoinProof` | Kernel | ZK proof of coin ownership |
| `nativeToken()` | Helper | MNT token type identifier |
| `tokenType(addr)` | Helper | Custom token type identifier |
| `evolveNonce` | Helper | Replay-protected nonce chaining |
| `shieldedBurnAddress()` | Helper | Canonical token burn address |
| `receiveShielded` | Transfer | Accept incoming shielded coins |
| `sendShielded` | Transfer | Send shielded coins to recipient |
| `getBlockTime()` | Time | Current block timestamp |
| `getBlockNumber()` | Time | Current block height |
| `getEpoch()` | Time | Current consensus epoch |

---

## Final Notes

The Compact standard library is deliberately minimal. Midnight's philosophy is to give you the cryptographic building blocks and let you compose them — rather than shipping high-level abstractions that bake in assumptions about your use case.

The types you'll reach for in every contract: `Maybe<T>`, `ContractAddress`, `receiveShielded`, `sendShielded`. Everything else is situational. Learn the Merkle utilities when you need provable state membership. Learn the elliptic curve types when you're building custom commitment schemes. Learn `Either<L, R>` when you need structured circuit outputs.

The biggest gotcha for newcomers: all of these operations happen inside ZK circuits. "Optional" doesn't mean "try/catch" — it means "the proof is either valid or it isn't." Design your circuits with that constraint in mind, and you'll avoid the most common debugging headaches.

All code examples in this guide are available as individual `.compact` files at [github.com/your-username/compact-stdlib-guide](https://github.com/your-username/compact-stdlib-guide), ready to compile and test with the Midnight SDK.
