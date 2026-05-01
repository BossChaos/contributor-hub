// Private NFT Marketplace - Express Backend
// REST API for marketplace operations

import express from 'express';
import { generatePriceCommitment, generateBidCommitment } from '../contract/witness';

const app = express();
app.use(express.json());

// In-memory storage (replace with database in production)
const listings = new Map();
const bids = new Map();

// Create listing
app.post('/api/listings', async (req, res) => {
  try {
    const { nftContract, tokenId, price, seller } = req.body;

    // Generate price commitment
    const commitment = await generatePriceCommitment(BigInt(price));

    const listingId = listings.size;
    listings.set(listingId, {
      listingId,
      nftContract,
      tokenId: BigInt(tokenId),
      price: BigInt(price),
      priceCommitment: Buffer.from(commitment).toString('hex'),
      seller,
      isAuction: false,
      active: true,
    });

    res.json({ listingId, commitment: Buffer.from(commitment).toString('hex') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create auction
app.post('/api/auctions', async (req, res) => {
  try {
    const { nftContract, tokenId, durationSeconds, seller } = req.body;

    const listingId = listings.size;
    const currentTime = Math.floor(Date.now() / 1000);
    const auctionEnd = currentTime + Number(durationSeconds);

    listings.set(listingId, {
      listingId,
      nftContract,
      tokenId: BigInt(tokenId),
      seller,
      isAuction: true,
      auctionEnd,
      active: true,
    });

    res.json({ listingId, auctionEnd });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit bid
app.post('/api/bids', async (req, res) => {
  try {
    const { listingId, bidAmount, bidderAddress, nonce } = req.body;

    // Generate bid commitment
    const commitment = await generateBidCommitment(
      BigInt(bidAmount),
      bidderAddress,
      BigInt(nonce)
    );

    const bidKey = `${listingId}_${Buffer.from(commitment).toString('hex')}`;
    bids.set(bidKey, {
      listingId: Number(listingId),
      commitment: Buffer.from(commitment).toString('hex'),
      amount: BigInt(bidAmount),
      bidder: bidderAddress,
    });

    res.json({ bidKey, commitment: Buffer.from(commitment).toString('hex') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get listing
app.get('/api/listings/:id', (req, res) => {
  const listing = listings.get(Number(req.params.id));
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  res.json(listing);
});

// Get all listings
app.get('/api/listings', (req, res) => {
  const allListings = Array.from(listings.values());
  res.json(allListings);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Marketplace backend running on port ${PORT}`);
});

export default app;
