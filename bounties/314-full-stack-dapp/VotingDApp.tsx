// React Frontend for Voting dApp
// Simple component demonstrating Midnight dApp UI

import React, { useState, useEffect } from 'react';
import { createVoteTransaction } from './voting-witness';

interface VotingOption {
    id: string;
    name: string;
    votes: number;
}

interface VotingProps {
    contractAddress: string;
    wallet: any; // Midnight wallet
}

export const VotingDApp: React.FC<VotingProps> = ({ contractAddress, wallet }) => {
    const [options, setOptions] = useState<VotingOption[]>([]);
    const [hasVoted, setHasVoted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load voting options
    useEffect(() => {
        loadOptions();
    }, [contractAddress]);

    const loadOptions = async () => {
        try {
            setLoading(true);
            // Fetch options from contract
            // In production, use actual contract query
            const mockOptions: VotingOption[] = [
                { id: 'option-a', name: 'Option A', votes: 0 },
                { id: 'option-b', name: 'Option B', votes: 0 },
                { id: 'option-c', name: 'Option C', votes: 0 },
            ];
            setOptions(mockOptions);
            setError(null);
        } catch (err) {
            setError('Failed to load voting options');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleVote = async (optionId: string) => {
        if (hasVoted) {
            setError('You have already voted');
            return;
        }

        try {
            setLoading(true);
            
            // Create vote transaction
            const transaction = await createVoteTransaction();
            
            // Sign with wallet
            const signedTx = await wallet.sign(transaction);
            
            // Submit to network
            await wallet.submit(signedTx);
            
            setHasVoted(true);
            setError(null);
            
            // Refresh results
            await loadOptions();
        } catch (err) {
            setError('Failed to cast vote');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="loading">Loading voting options...</div>;
    }

    if (error) {
        return <div className="error">{error}</div>;
    }

    return (
        <div className="voting-dapp">
            <h1>Privacy-Preserving Voting</h1>
            
            {hasVoted ? (
                <div className="voted-message">
                    <p>Thank you for voting! Your vote has been recorded.</p>
                </div>
            ) : (
                <div className="vote-options">
                    <h2>Select your option:</h2>
                    {options.map(option => (
                        <button
                            key={option.id}
                            onClick={() => handleVote(option.id)}
                            className="vote-button"
                        >
                            {option.name}
                        </button>
                    ))}
                </div>
            )}
            
            <div className="results">
                <h2>Current Results:</h2>
                {options.map(option => (
                    <div key={option.id} className="result-item">
                        <span>{option.name}</span>
                        <span>{option.votes} votes</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default VotingDApp;
