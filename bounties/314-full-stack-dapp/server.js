// Backend API Server for Voting dApp
// Express server providing contract interaction endpoints

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Mock contract state (in production, use actual Midnight contract)
let contractState = {
    options: [
        { id: 'option-a', name: 'Option A', votes: 0 },
        { id: 'option-b', name: 'Option B', votes: 0 },
        { id: 'option-c', name: 'Option C', votes: 0 },
    ],
    usedNullifiers: new Set(),
    isActive: true,
};

// Get voting options
app.get('/api/options', (req, res) => {
    res.json({
        success: true,
        data: contractState.options,
    });
});

// Get voting results
app.get('/api/results', (req, res) => {
    res.json({
        success: true,
        data: contractState.options.map(opt => ({
            id: opt.id,
            name: opt.name,
            votes: opt.votes,
        })),
    });
});

// Check if address has voted
app.post('/api/has-voted', (req, res) => {
    const { nullifier } = req.body;
    
    if (!nullifier) {
        return res.status(400).json({
            success: false,
            error: 'Nullifier is required',
        });
    }
    
    const hasVoted = contractState.usedNullifiers.has(nullifier);
    
    res.json({
        success: true,
        data: { hasVoted },
    });
});

// Submit vote
app.post('/api/vote', async (req, res) => {
    const { nullifier, optionId } = req.body;
    
    // Validate input
    if (!nullifier || !optionId) {
        return res.status(400).json({
            success: false,
            error: 'Nullifier and optionId are required',
        });
    }
    
    // Check if already voted
    if (contractState.usedNullifiers.has(nullifier)) {
        return res.status(400).json({
            success: false,
            error: 'Already voted',
        });
    }
    
    // Find option
    const option = contractState.options.find(opt => opt.id === optionId);
    if (!option) {
        return res.status(400).json({
            success: false,
            error: 'Invalid option',
        });
    }
    
    // Record vote
    option.votes += 1;
    contractState.usedNullifiers.add(nullifier);
    
    res.json({
        success: true,
        data: {
            message: 'Vote recorded successfully',
            option: option.name,
        },
    });
});

// Start voting period
app.post('/api/voting/start', (req, res) => {
    const { startTime, endTime } = req.body;
    
    if (!startTime || !endTime) {
        return res.status(400).json({
            success: false,
            error: 'Start and end times are required',
        });
    }
    
    contractState.isActive = true;
    
    res.json({
        success: true,
        data: {
            message: 'Voting started',
            startTime,
            endTime,
        },
    });
});

// End voting period
app.post('/api/voting/end', (req, res) => {
    contractState.isActive = false;
    
    res.json({
        success: true,
        data: {
            message: 'Voting ended',
        },
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'healthy',
            uptime: process.uptime(),
        },
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Voting dApp API server running on port ${PORT}`);
});

module.exports = app;
