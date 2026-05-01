# Private NFT Marketplace on Midnight

A privacy-preserving NFT marketplace built on Midnight Network, featuring blind auctions, private listings, and automatic royalty enforcement.

## Features

- 🔒 **Private Listings**: Prices hidden via commitment schemes
- 🏷️ **Blind Auctions**: Prevent bid sniping with commit-reveal
- 💰 **Royalty Enforcement**: Automatic creator compensation (up to 10%)
- 🛡️ **Secure Escrow**: NFTs held safely during transactions
- 📊 **Marketplace Stats**: Track sales volume and activity

## Architecture

```
private-nft-marketplace/
├── contract/
│   ├── contract.compact      # Midnight Compact contract
│   └── witness.ts            # TypeScript witness generation
├── tests/
│   └── marketplace.test.ts   # Jest test suite
├── backend/
│   └── server.ts             # Express REST API
├── TUTORIAL.md               # Complete tutorial (3,500+ words)
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Midnight development environment

### Installation

```bash
npm install
```

### Run Tests

```bash
npm test
```

### Start Backend

```bash
cd backend
npm start
```

### Compile Contract

```bash
midnight compile contract/contract.compact
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/listings` | Create fixed-price listing |
| POST | `/api/auctions` | Create auction listing |
| POST | `/api/bids` | Submit blind bid |
| GET | `/api/listings/:id` | Get listing details |
| GET | `/api/listings` | Get all listings |

## Security

- SHA-256 commitment schemes for price/bid privacy
- Nonce-based commitment collision prevention
- Domain separation between price and bid commitments
- Maximum 10% royalty cap
- Seller self-purchase prevention

## Tutorial

See [TUTORIAL.md](./TUTORIAL.md) for complete development guide.

## License

MIT

## Contact

For NIGHT token payments: `0xdaE5d307339074A24F579dB48e7c639359D94904` (BSC/BEP20)
