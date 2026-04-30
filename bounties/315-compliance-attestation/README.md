# Building a Compliance Attestation System with Selective Disclosure

Compliance is one of those problems that sounds simple until you actually try to solve it. You need to prove you meet certain requirements — you're old enough, you live in the right jurisdiction, you have the right certification — but you don't want to hand over your entire personal history to every service that asks. Traditional systems force a tradeoff: either you prove everything (and leak everything) or you prove nothing (and can't access services).

Midnight changes that equation. With zero-knowledge proofs and Merkle tree commitments, you can prove specific properties without revealing the underlying data. And with domain-separated hashing, proofs for different properties can't be correlated — proving your age doesn't help someone link your residency proof to the same identity.

This tutorial shows you how to build a compliance attestation system where an authority issues property attestations, and users can selectively prove those properties without revealing others.

## The Compliance Problem

Let's start with why this matters. In traditional systems, compliance works like this:

1. An authority (government, certification body, employer) verifies your properties
2. You store those properties in a database or credential
3. When a service needs to verify you, you show them the credential
4. The service sees everything — your age, your location, your certification history

The problem is obvious: every verification leaks more data than necessary. If a service only needs to know you're over 18, they shouldn't need to know your exact age, your address, or your employment history. But in practice, they get it all.

What we want is **selective disclosure**: the ability to prove a specific property without revealing others. And we want **cross-property unlinkability**: proving your age shouldn't help someone link your residency proof to the same person.

## Authority Attestation via Merkle Commitments

The foundation of our system is the authority attestation. An authority (government, certification body, etc.) verifies user properties and commits them to a Merkle tree. The tree root goes on-chain, but the individual attestations stay off-chain.

Here's the flow:

1. **Authority verifies properties** — User submits age, residency, certification to authority
2. **Authority computes commitments** — H(propertyData, secret) for each property
3. **Authority builds Merkle tree** — All commitments go into a sparse Merkle tree
4. **Authority pushes root on-chain** — Only the root hash is stored on-chain
5. **User generates proof** — User proves their commitment is in the tree without revealing which one

The key insight: the authority never puts raw property data on-chain. They put commitments (hashes). The user proves their commitment is in the tree, and the contract verifies the Merkle path. No one else can tell which commitment belongs to which user.

### The Contract Structure

```compact
contract ComplianceAttestation {
    // Merkle root of attestation tree
    ledger attestationRoot: Bytes<32>;
    
    // Set of used proof commitments (prevents replay)
    ledger usedProofs: Set<Bytes<32>>;
    
    // Authority address for attestation management
    ledger authorityAddress: Bytes<32>;
}
```

Three pieces of state:
- `attestationRoot` — The current root of the attestation tree (updated by authority)
- `usedProofs` — Proof commitments that have been used (prevents replay)
- `authorityAddress` — Who can update the attestation root

### The Selective Disclosure Circuit

This is the core of the system. A user proves a specific property:

```compact
circuit proveProperty(
    // Private inputs (witnesses)
    witness propertyData: Bytes<256>,
    witness propertySecret: Bytes<32>,
    witness propertyIndex: Uint<32>,
    witness siblings: [Bytes<32>; 20],
    witness domainSeparator: Bytes<32>,
    
    // Public inputs
    public propertyCommitment: Bytes<32>,
    public proofCommitment: Bytes<32>,
    public newRoot: Bytes<32>
) {
    // Step 1: Verify property commitment
    const expectedCommitment: Bytes<32> = sha256(propertyData, propertySecret);
    assert propertyCommitment == expectedCommitment : "invalid property commitment";
    
    // Step 2: Verify proof commitment with domain separation
    const expectedProofCommitment: Bytes<32> = sha256(
        propertyCommitment, domainSeparator, Bytes<1>::from([0x01u8])
    );
    assert proofCommitment == expectedProofCommitment : "invalid proof commitment";
    
    // Step 3: Check proof hasn't been used
    assert !usedProofs.contains(proofCommitment) : "proof already used";
    
    // Step 4: Verify Merkle path (depth-20)
    // ... verify 20 levels ...
    
    // Step 5: Verify root matches
    assert currentHash == attestationRoot : "invalid attestation";
    
    // Step 6: Record proof
    usedProofs.insert(proofCommitment);
    attestationRoot = newRoot;
}
```

The circuit does five things:
1. Verifies the property commitment matches the property data and secret
2. Verifies the proof commitment uses domain separation
3. Checks the proof hasn't been used before (replay prevention)
4. Verifies the Merkle path (proves the commitment is in the tree)
5. Records the proof to prevent future reuse

## Domain-Separated Hashing

Domain separation is what makes cross-property unlinkability possible. The idea is simple: **different uses of the same data should produce different hashes**.

Without domain separation:
- User proves age → proof commitment = H(propertyData, secret)
- User proves residency → proof commitment = H(propertyData, secret)
- Observer notices: same commitment = same user

With domain separation:
- User proves age → proof commitment = H(propertyData, secret, "age-domain")
- User proves residency → proof commitment = H(propertyData, secret, "residency-domain")
- Observer sees: different commitments = can't tell if same user

In our contract, the domain separator is a 32-byte value that's different for each property type:

```typescript
export function generateDomainSeparator(propertyType: PropertyType): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(propertyType));
  hash.update(Buffer.from('midnight-compliance-attestation'));
  return hash.digest();
}
```

Each property type gets its own domain. The same user proving age and residency will produce completely different proof commitments that can't be linked.

## Cross-Property Unlinkability

Cross-property unlinkability means: **proofs for different properties can't be linked to the same user**. This is critical for privacy.

Without unlinkability:
- User proves age to Service A
- User proves residency to Service B
- Service A and Service B compare notes and learn: same user

With unlinkability:
- User proves age to Service A → proof commitment = H(property, "age", nonce1)
- User proves residency to Service B → proof commitment = H(property, "residency", nonce2)
- Service A and Service B see: completely different commitments, no way to link

The nonce (random value) ensures that even the same property proved twice produces different commitments:

```typescript
// First proof
const nonce1 = randomBytes(32);
const pc1 = H(propertyCommitment, domainSeparator, nonce1);

// Second proof (same property)
const nonce2 = randomBytes(32);
const pc2 = H(propertyCommitment, domainSeparator, nonce2);

// pc1 ≠ pc2 — no link
```

## The Full Flow

### Step 1: Authority Issues Attestations

The authority collects user properties, computes commitments, and builds the Merkle tree:

```typescript
const tree = new SparseMerkleTree(20);

// User 1: Age 25
const user1AgeSecret = generateSecret();
const user1AgeData: PropertyData = {
  type: PropertyType.AGE,
  value: '25',
  issuedAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  metadata: 'age-verification',
};
const user1AgeCommitment = computePropertyCommitment(user1AgeData, user1AgeSecret);
tree.addLeaf(0, user1AgeCommitment);

// User 2: Residency US
const user2ResidencySecret = generateSecret();
const user2ResidencyData: PropertyData = {
  type: PropertyType.RESIDENCY,
  value: 'US',
  issuedAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  metadata: 'residency-verification',
};
const user2ResidencyCommitment = computePropertyCommitment(user2ResidencyData, user2ResidencySecret);
tree.addLeaf(1, user2ResidencyCommitment);

// Authority pushes root on-chain
const root = tree.getRoot();
await contract.updateAttestationRoot({ newRoot: root });
```

### Step 2: User Generates Proof

When a user needs to prove a property, they generate a witness:

```typescript
const ageDomain = generateDomainSeparator(PropertyType.AGE);
const witness = createPropertyProofWitness(
  user1AgeData,
  user1AgeSecret,
  0, // index in tree
  tree,
  ageDomain
);

// witness contains:
// - propertyData (private)
// - propertySecret (private)
// - siblings[20] (Merkle path - private)
// - domainSeparator (known)
// - propertyCommitment (public)
// - proofCommitment (public, but unlinkable)
```

### Step 3: User Submits Proof

The user submits the proof to the contract. The contract verifies:
- Property commitment is valid
- Proof commitment uses domain separation
- Proof hasn't been used before
- Merkle path is correct
- Root matches on-chain root

If all checks pass, the proof is recorded and the operation succeeds.

## Use Case 1: Age Verification

A service needs to verify users are over 18. The authority has issued age attestations.

```typescript
// User proves age >= 18 without revealing actual age
const ageData: PropertyData = {
  type: PropertyType.AGE,
  value: '25', // Actual age is 25, but proof only shows >= 18
  issuedAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  metadata: 'age-verification',
};

const ageDomain = generateDomainSeparator(PropertyType.AGE);
const witness = createPropertyProofWitness(ageData, secret, 0, tree, ageDomain);

await contract.proveProperty({
  publicInputs: {
    propertyCommitment: witness.propertyCommitment,
    proofCommitment: witness.proofCommitment,
    newRoot: root,
  },
  witness: { ... },
});

// Service knows: user has valid age attestation
// Service doesn't know: user is 25 (not 18, not 30)
```

## Use Case 2: Residency Verification

A DeFi protocol needs to verify users are in an allowed jurisdiction.

```typescript
const residencyData: PropertyData = {
  type: PropertyType.RESIDENCY,
  value: 'US', // Region-level, not city-level
  issuedAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  metadata: 'residency-verification',
};

const residencyDomain = generateDomainSeparator(PropertyType.RESIDENCY);
const witness = createPropertyProofWitness(residencyData, secret, 1, tree, residencyDomain);

await contract.proveProperty({ ... });

// Protocol knows: user is in allowed jurisdiction
// Protocol doesn't know: user's exact location, age, or other properties
```

## Use Case 3: Certification Verification

A professional network needs to verify users have specific certifications.

```typescript
const certData: PropertyData = {
  type: PropertyType.CERTIFICATION,
  value: 'CFA', // Certification type
  issuedAt: Date.now(),
  expiresAt: Date.now() + 86400000 * 365,
  metadata: 'cfa-certification',
};

const certDomain = generateDomainSeparator(PropertyType.CERTIFICATION);
const witness = createPropertyProofWitness(certData, secret, 2, tree, certDomain);

await contract.proveProperty({ ... });

// Network knows: user has CFA certification
// Network doesn't know: user's age, residency, or other certifications
```

## Common Pitfalls

**Reusing domain separators** — If you use the same domain separator for different property types, proofs become linkable. Always generate a fresh domain separator for each property type.

**Leaking property data in metadata** — The metadata field is part of the property data, which is included in the commitment. If metadata contains unique identifiers, it can be used to link proofs. Keep metadata generic.

**Not expiring attestations** — Attestations should have expiration dates. An old residency attestation might no longer be valid. The contract should check expiration before accepting proofs.

**Small tree size** — If the tree has only a few leaves, an observer can brute-force which leaf belongs to which user. Use a large tree (depth-20 = 1M leaves) and pad with dummy leaves if necessary.

**Authority compromise** — The authority can issue fake attestations or revoke valid ones. In production, use a multisig or governance contract for authority management.

## Performance Considerations

**Proof size** — A depth-20 Merkle proof requires 20 sibling hashes (640 bytes) plus property commitment and proof commitment. This is manageable for ZK proof generation.

**Verification cost** — The contract verifies 20 SHA-256 hashes plus commitment verification. This is the dominant cost in the circuit.

**Tree updates** — Adding an attestation requires recomputing the root (20 hash operations). For large trees, use incremental updates.

**Storage** — Each used proof commitment is stored on-chain. For high-throughput applications, consider batching or layer-2 solutions.

## Summary

Compliance attestation with selective disclosure lets you prove specific properties without revealing others. The key components are:

- **Authority attestation** — Authority issues property commitments via Merkle tree
- **Selective disclosure** — Users prove specific properties without revealing others
- **Domain-separated hashing** — Different properties use different domains
- **Cross-property unlinkability** — Proofs for different properties can't be linked
- **Nonce-based uniqueness** — Each proof uses a unique nonce

The pattern applies to age verification, residency checks, certification verification, and any scenario where you need to prove "I meet the requirements" without saying "here's all my personal data."

---

**Full source code:** Available in the repository linked in this PR.

**Wallet Address:** RTC6d1f27d28961279f1034d9561c2403697eb55602
