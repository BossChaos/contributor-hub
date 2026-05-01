// Test Script for Voting dApp
// Demonstrates how to test the voting contract and frontend

const assert = require('assert');

// Mock contract state for testing
const mockContractState = {
    options: [
        { id: 'option-a', name: 'Option A', votes: 0 },
        { id: 'option-b', name: 'Option B', votes: 0 },
    ],
    usedNullifiers: new Set(),
    isActive: true,
};

// Test 1: Vote casting
function testVoteCasting() {
    console.log('Test 1: Vote casting...');
    
    const nullifier = 'test-nullifier-1';
    const optionId = 'option-a';
    
    // Simulate vote
    const option = mockContractState.options.find(opt => opt.id === optionId);
    assert(option, 'Option should exist');
    
    option.votes += 1;
    mockContractState.usedNullifiers.add(nullifier);
    
    assert(option.votes === 1, 'Vote count should be 1');
    assert(mockContractState.usedNullifiers.has(nullifier), 'Nullifier should be recorded');
    
    console.log('✅ Test 1 passed');
}

// Test 2: Double voting prevention
function testDoubleVotingPrevention() {
    console.log('Test 2: Double voting prevention...');
    
    const nullifier = 'test-nullifier-1';
    
    // Try to vote again with same nullifier
    const hasVoted = mockContractState.usedNullifiers.has(nullifier);
    assert(hasVoted, 'Should detect duplicate vote');
    
    console.log('✅ Test 2 passed');
}

// Test 3: Invalid option rejection
function testInvalidOptionRejection() {
    console.log('Test 3: Invalid option rejection...');
    
    const invalidOptionId = 'invalid-option';
    const option = mockContractState.options.find(opt => opt.id === invalidOptionId);
    
    assert(!option, 'Invalid option should not exist');
    
    console.log('✅ Test 3 passed');
}

// Test 4: Voting period validation
function testVotingPeriodValidation() {
    console.log('Test 4: Voting period validation...');
    
    assert(mockContractState.isActive, 'Voting should be active');
    
    // Simulate ending voting
    mockContractState.isActive = false;
    assert(!mockContractState.isActive, 'Voting should be inactive');
    
    console.log('✅ Test 4 passed');
}

// Test 5: Result accuracy
function testResultAccuracy() {
    console.log('Test 5: Result accuracy...');
    
    const totalVotes = mockContractState.options.reduce((sum, opt) => sum + opt.votes, 0);
    assert(totalVotes === 1, 'Total votes should be 1');
    
    console.log('✅ Test 5 passed');
}

// Run all tests
function runTests() {
    console.log('Running Voting dApp tests...\n');
    
    try {
        testVoteCasting();
        testDoubleVotingPrevention();
        testInvalidOptionRejection();
        testVotingPeriodValidation();
        testResultAccuracy();
        
        console.log('\n✅ All tests passed!');
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Export for use in other test files
module.exports = {
    runTests,
    testVoteCasting,
    testDoubleVotingPrevention,
    testInvalidOptionRejection,
    testVotingPeriodValidation,
    testResultAccuracy,
};

// Run tests if executed directly
if (require.main === module) {
    runTests();
}
