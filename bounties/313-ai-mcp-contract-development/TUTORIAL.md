

# Using midnight-mcp for Contract Development with AI Assistants

I'll be honest — when I first started writing Compact smart contracts for Midnight, I was doing it the hard way. Manually compiling, reading through opaque error messages, and manually auditing witness data for privacy leaks. Then I discovered `midnight-mcp`, and it genuinely changed how I work. Instead of context-switching between my editor and a terminal, I can validate contracts, catch type errors, and run security analysis right from my AI assistant conversation.

If you're building on Midnight and haven't tried the MCP tool yet, this guide will get you set up in about 15 minutes. I'll walk through installing it, wiring it into both Cursor and Claude Desktop, and then work through a real example — building a private voting contract — where you'll see exactly how the tool catches things.

## Prerequisites

Before we dive in, make sure you have:

- **Node.js 18+** installed — `node -v` to check
- **Cursor** or **Claude Desktop** — I'll cover both
- Basic terminal comfort — nothing fancy, just navigating directories and running commands
- A Midnight development environment set up (the `midnight-cli` tools installed, which you'll get from the standard setup script)

That's it. No ZK expertise required beyond whatever you already have.

## Step 1: Installing midnight-mcp Globally via npm

The MCP tool is published as an npm package, so installation is straightforward:

```bash
npm install -g midnight-mcp
```

Verify it installed correctly:

```bash
npx midnight-mcp --version
```

You should see a version number print out. If you get a permission error on Linux/macOS, use `sudo npm install -g midnight-mcp` or configure your npm prefix correctly — I've seen this catch people off guard when they're on a fresh machine.

One thing to note: the global install means the tool is available anywhere in your terminal, but the MCP server itself runs as a separate process. You don't need to think about this most of the time, but if you're on Windows and seeing path issues, make sure your npm global bin is in your `PATH`.

## Step 2: Configuring Your AI Assistant

This is where things split — Cursor and Claude Desktop use different configuration mechanisms. I'll cover both.

### For Cursor

Open your Cursor settings (⌘/Ctrl + ,), navigate to **Features → Model Context Protocol**, and add a new MCP server. The JSON config looks like this:

```json
{
  "mcpServers": {
    "midnight": {
      "command": "npx",
      "args": ["-y", "midnight-mcp", "server"],
      "env": {
        "MIDNIGHT_NETWORK": "testnet"
      }
    }
  }
}
```

Cursor will pick this up and expose the `midnight` tool to whichever model you're chatting with. You'll see it listed under the MCP tools panel in your conversation.

### For Claude Desktop

Claude Desktop uses a local `claude_desktop_config.json` file. On macOS/Linux, this lives at `~/.config/Claude/claude_desktop_config.json`. On Windows, it's in your AppData folder. Add the same server block:

```json
{
  "mcpServers": {
    "midnight": {
      "command": "npx",
      "args": ["-y", "midnight-mcp", "server"],
      "env": {
        "MIDNIGHT_NETWORK": "testnet"
      }
    }
  }
}
```

After saving, restart Claude Desktop. You can verify the connection is working by asking Claude: "What midnight-mcp tools are available?" — it should list the validation, compilation, and analysis tools without error.

**One gotcha I ran into:** Claude Desktop caches MCP configs aggressively. If you edit the config, a full restart isn't always enough — try killing the Claude Desktop background process and relaunching. I've wasted 20 minutes on this before.

## Step 3: Building a Private Vote Contract

Let's get practical. We're going to write a Compact contract for a private voting system — the kind of thing Midnight is built for. No vote should be traceable to a specific voter, but the final tally needs to be verifiable.

Here's my first draft, which I'll walk through:

```compact
// PrivateVote.compact
import midnight::prelude::{Address, Field, MerkleTree};

// A private voting contract with commit-reveal pattern
contract PrivateVote {
  // Merkle root of registered voters
  pub const voter_root: Field;

  // Accumulated vote commitments (one per candidate)
  state vote_tally: Map<Candidate, Field>;

  // Track voter commitment nullifiers to prevent double-voting
  state nullifiers: Set<Field>;

  struct VoteWitness {
    voter_proof: MerkleProof,
    chosen_candidate: Candidate,
    nullifier_secret: Field,
  }

  // Cast a private vote
  pub fn cast_vote(witness: VoteWitness, candidate: Candidate) -> Field {
    // Verify voter is registered
    let is_registered = MerkleTree.verify(
      witness.voter_proof,
      this.voter_root
    );
    require(is_registered, "Invalid voter proof");

    // Derive nullifier to prevent double-spending
    let nullifier = PoseidonHash([
      witness.nullifier_secret,
      this.tx_hash
    ]);

    require(!this.nullifiers.contains(nullifier), "Already voted");
    this.nullifiers.insert(nullifier);

    // Commit the vote without revealing the choice
    let vote_commitment = PoseidonHash([
      Field.from_u32(candidate.id),
      witness.nullifier_secret
    ]);

    // Add to the appropriate tally
    let current = this.vote_tally.get(candidate).unwrap_or(Field.zero());
    this.vote_tally.set(candidate, current + Field.one());

    return vote_commitment;
  }
}
```

Looks reasonable, right? I thought so too. Then I asked the MCP tool to validate it.

**Here's what the MCP tool immediately caught:**

```
[VALIDATION ERROR] Line 8: Type mismatch in Map key.
  Expected: address type for Map<Candidate, Field>
  Actual: Candidate is a user-defined struct with no Address coercion.

[VALIDATION ERROR] Line 24: `this.tx_hash` is not accessible in pub fn scope.
  Transaction context fields require @implicit caller annotation.

[VALIDATION ERROR] Line 30: `unwrap_or` called on Map getter — Option types
  not supported for Map.get() in this context. Use .get() with explicit
  null-check instead.
```

Three real bugs in a 30-line draft. The type mismatch on line 8 is the classic one — I assumed `Candidate` had an `Address` representation it doesn't. The `tx_hash` access is a Midnight-specific scoping rule that's easy to miss. And the `unwrap_or` issue is just me carrying habits from Rust that don't translate.

Here's the corrected version:

```compact
// PrivateVote.compact — validated version
import midnight::prelude::{Address, Field, MerkleTree, PoseidonHash};

contract PrivateVote {
  pub const voter_root: Field;

  // Tally keyed by candidate ID (u8) for type safety
  state vote_tally: Map<u8, Field>;
  state nullifiers: Set<Field>;

  struct VoteWitness {
    voter_proof: MerkleProof,
    chosen_candidate_id: u8,
    nullifier_secret: Field,
  }

  pub fn cast_vote(witness: VoteWitness, candidate: Candidate) -> Field {
    let is_registered = MerkleTree.verify(
      witness.voter_proof,
      this.voter_root
    );
    require(is_registered, "Invalid voter proof");

    // Note: use @implicit(Address) to access tx context
    let nullifier = PoseidonHash([
      witness.nullifier_secret,
      @implicit(Address).tx_hash
    ]);

    require(!this.nullifiers.contains(nullifier), "Already voted");
    this.nullifiers.insert(nullifier);

    let vote_commitment = PoseidonHash([
      Field.from_u8(witness.chosen_candidate_id),
      witness.nullifier_secret
    ]);

    let current = this.vote_tally.get(witness.chosen_candidate_id);
    let new_tally = match current {
      Some(v) => v + Field.one(),
      None => Field.one(),
    };
    this.vote_tally.set(witness.chosen_candidate_id, new_tally);

    return vote_commitment;
  }
}
```

The workflow here is the real win: I draft freely, hand the messy code to the MCP tool, get specific line-by-line feedback, and iterate. No manual `midnight-compile` in the terminal, no hunting for error messages.

## Step 4: Security Analysis — Catching Privacy Leaks

This is where MCP-assisted development really shines for Midnight. Privacy bugs in Compact contracts aren't always obvious — they're often in the *witness design*, not the contract logic itself.

I asked the AI assistant (with the MCP tool active) to run a privacy audit on the corrected contract above. Here's what it flagged:

**Finding 1 — Witness data leakage in `VoteWitness`:**

> "The `voter_proof` MerkleProof includes intermediate sibling nodes that could be correlated across multiple votes from the same voter. Consider using a incremental Merkle tree proof structure that reveals only the minimal necessary path."

This is a subtle but real issue. If the same voter casts multiple votes, the structure of their Merkle proof could be used to link those votes on-chain, even though the votes themselves are encrypted.

**Finding 2 — Nullifier derivation is predictable:**

> "`PoseidonHash([nullifier_secret, tx_hash])` is deterministic for a given transaction. An observer who knows `nullifier_secret` (voter knows their own secret) could track their own vote commitment on-chain, de-anonymizing the commit-reveal timeline."

The recommendation was to add a per-election randomness component to the nullifier derivation:

```compact
let nullifier = PoseidonHash([
  witness.nullifier_secret,
  @implicit(Address).tx_hash,
  this.election_id  // Added: prevents observer from tracking own vote
]);
```

**Finding 3 — Candidate ID in vote commitment:**

> "The `vote_commitment` embeds `Field.from_u8(witness.chosen_candidate_id)` directly. While hashed, this constrains the space of possible commitments. For high-stakes votes, consider encoding the vote as a Pedersen commitment with a blinding factor instead."

These aren't the kind of issues that show up as compilation errors — they compile just fine. They're logic-level privacy vulnerabilities, and having the MCP tool reason about them as part of my normal development flow is genuinely valuable.

## A Note on AI-Generated Code

I'll be direct: don't treat the AI as infallible just because it's running through the MCP tool. The tool validates *syntax and type safety*, which catches a lot, but it doesn't replace understanding what you're building. I've had the AI suggest perfectly type-correct code that was subtly wrong in its privacy assumptions.

The workflow I've settled on is: draft with AI → validate through MCP → review the logic myself → repeat. The MCP compilation step is non-negotiable before anything goes near a testnet. Think of it like `rustc` — it catches your typos, not your design mistakes.

## Conclusion

`midnight-mcp` isn't a magic wand, but it removes enough friction that I genuinely wonder how I worked without it. The big wins for me:

- **Iterative validation** — catch type errors and scoping issues before you even run a compile
- **Privacy-aware auditing** — the tool reasons about witness data flows, which is the part of Compact development that's hardest to get right
- **Zero terminal context-switching** — staying in the AI conversation means you can act on feedback immediately

My practical tips in closing: always run the MCP validation step as a gate before compiling, treat privacy findings from the analysis tool as first-class issues (not post-launch concerns), and if you're new to Compact, lean on the tool heavily while you're learning the type system — the error messages will teach you the language's conventions faster than docs will.

The ZK smart contract space is moving fast, and tools like this are what make it accessible to developers who aren't ZK researchers by trade. Give it a shot on your next contract.

---

#MidnightforDevs #ZK #AI #SmartContracts
