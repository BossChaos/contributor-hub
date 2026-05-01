/**
 * React frontend components for PrivateVoting dApp.
 *
 * This module demonstrates the key frontend interactions:
 * 1. Connecting to a Midnight wallet (Lace)
 * 2. Deploying the contract
 * 3. Interacting with the contract (casting votes)
 * 4. Reading contract state from the indexer
 */

import { useState, useEffect } from 'react';

// Types
interface Election {
    id: string;
    title: string;
    optionA: string;
    optionB: string;
    isOpen: boolean;
    votesA: number;
    votesB: number;
}

interface WalletState {
    address: string;
    isConnected: boolean;
}

// Wallet connection hook (using Lace wallet)
function useWallet(): WalletState & { connect: () => Promise<void> } {
    const [wallet, setWallet] = useState<WalletState>({
        address: '',
        isConnected: false,
    });

    // Connect to Lace wallet
    const connect = async () => {
        // @ts-ignore - Lace wallet types
        if (window.lace) {
            // @ts-ignore
            const address = await window.lace.getUsedAddresses();
            setWallet({
                address: address[0],
                isConnected: true,
            });
        } else {
            alert('Please install Lace wallet');
        }
    };

    return { ...wallet, connect };
}

/**
 * VoteCard component - displays voting options and handles vote submission.
 */
function VoteCard({
    election,
    onVote,
}: {
    election: { optionA: string; optionB: string };
    onVote: (option: number) => void;
}) {
    return (
        <div className="vote-card">
            <h2>Cast Your Vote</h2>
            <div className="options">
                <button
                    className="option-button"
                    onClick={() => onVote(0)}
                >
                    {election.optionA}
                </button>
                <button
                    className="option-button"
                    onClick={() => onVote(1)}
                >
                    {election.optionB}
                </button>
            </div>
        </div>
    );
}

/**
 * Results component - displays the current vote tally.
 */
function Results({
    votesA,
    votesB,
    totalVoters,
    isOpen,
}: {
    votesA: number;
    votesB: number;
    totalVoters: number;
    isOpen: boolean;
}) {
    const total = votesA + votesB;
    const percentA = total > 0 ? Math.round((votesA / total) * 100) : 0;
    const percentB = total > 0 ? Math.round((votesB / total) * 100) : 0;

    return (
        <div className="results">
            <h2>Vote Results</h2>
            {isOpen && <span className="badge">Voting Open</span>}
            <div className="progress-bar">
                <div className="progress option-a" style={{ width: `${percentA}%` }}>
                    Option A: {percentA}%
                </div>
                <div className="progress option-b" style={{ width: `${percentB}%` }}>
                    Option B: {percentB}%
                </div>
            </div>
            <p className="voter-count">Total voters: {totalVoters}</p>
        </div>
    );
}

export { useWallet, VoteCard, Results };
