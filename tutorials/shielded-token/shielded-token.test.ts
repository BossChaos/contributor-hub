/**
 * Shielded Token Tutorial - Test Suite
 *
 * Comprehensive tests for the shielded token contract compiled
 * with compactc v0.31.0. Validates the contract-info.json schema,
 * circuit signatures, ledger state layout, and ZKIR circuit files.
 *
 * These tests verify the contract's TypeScript API structure,
 * circuit signatures, and ledger state layout.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================
// CONTRACT INFO VALIDATION
// ============================================================

describe('Contract Structure', () => {
    let contractInfo: any;

    beforeAll(() => {
        const contractInfoPath = join(__dirname, '../managed/compiler/contract-info.json');
        contractInfo = JSON.parse(readFileSync(contractInfoPath, 'utf-8'));
    });

    it('should have correct compiler and language versions', () => {
        expect(contractInfo['compiler-version']).toBe('0.31.0');
        expect(contractInfo['language-version']).toBe('0.23.0');
    });

    it('should export all expected circuits', () => {
        const expectedCircuits = [
            'createShieldedToken',
            'nextNonce',
            'mintAndSend',
            'transferShielded',
            'burnShieldedToken',
            'burnByNonce',
            'depositShielded',
            'depositAndBurn',
        ];

        const actualCircuits = contractInfo.circuits.map((c: any) => c.name);

        expectedCircuits.forEach(circuit => {
            expect(actualCircuits).toContain(circuit);
        });
    });

    it('should have correct ledger state fields', () => {
        const expectedLedgerFields = ['totalSupply', 'totalBurned', 'coins'];

        const actualLedgerFields = contractInfo.ledger.map(
            (f: any) => f.name
        );

        expectedLedgerFields.forEach(field => {
            expect(actualLedgerFields).toContain(field);
        });
    });

    it('should have correct witness definitions', () => {
        const expectedWitnesses = ['localNonce'];

        const actualWitnesses = contractInfo.witnesses.map(
            (w: any) => w.name
        );

        expectedWitnesses.forEach(witness => {
            expect(actualWitnesses).toContain(witness);
        });
    });
});

// ============================================================
// CIRCUIT SIGNATURE TESTS
// ============================================================

describe('Circuit Signatures', () => {
    let contractInfo: any;

    beforeAll(() => {
        const contractInfoPath = join(__dirname, '../managed/compiler/contract-info.json');
        contractInfo = JSON.parse(readFileSync(contractInfoPath, 'utf-8'));
    });

    function getCircuit(name: string) {
        return contractInfo.circuits.find((c: any) => c.name === name);
    }

    function getArgNames(circuit: any): string[] {
        return (circuit.arguments || []).map((a: any) => a.name);
    }

    function getResultType(circuit: any): string {
        return circuit['result-type']?.name || 'void';
    }

    it('createShieldedToken should accept (amount, recipient) and return ShieldedCoinInfo', () => {
        const circuit = getCircuit('createShieldedToken');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['amount', 'recipient']);
        expect(getResultType(circuit)).toBe('ShieldedCoinInfo');
        expect(circuit.proof).toBe(true);
    });

    it('nextNonce should accept (index, currentNonce) and return void', () => {
        const circuit = getCircuit('nextNonce');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['index', 'currentNonce']);
        expect(getResultType(circuit)).toBe('void');
    });

    it('mintAndSend should accept (amount, recipient) and return ShieldedSendResult', () => {
        const circuit = getCircuit('mintAndSend');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['amount', 'recipient']);
        expect(getResultType(circuit)).toBe('ShieldedSendResult');
        expect(circuit.proof).toBe(true);
    });

    it('transferShielded should accept (coin, recipient, amount)', () => {
        const circuit = getCircuit('transferShielded');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['coin', 'recipient', 'amount']);
        expect(getResultType(circuit)).toBe('ShieldedSendResult');
        expect(circuit.proof).toBe(true);
    });

    it('burnShieldedToken should accept (coin, amount)', () => {
        const circuit = getCircuit('burnShieldedToken');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['coin', 'amount']);
        expect(getResultType(circuit)).toBe('ShieldedSendResult');
        expect(circuit.proof).toBe(true);
    });

    it('burnByNonce should accept (nonce, amount)', () => {
        const circuit = getCircuit('burnByNonce');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['nonce', 'amount']);
        expect(getResultType(circuit)).toBe('ShieldedSendResult');
        expect(circuit.proof).toBe(true);
    });

    it('depositShielded should accept (coin) and return void', () => {
        const circuit = getCircuit('depositShielded');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['coin']);
        expect(getResultType(circuit)).toBe('void');
    });

    it('depositAndBurn should accept (coin, amount)', () => {
        const circuit = getCircuit('depositAndBurn');
        expect(circuit).toBeDefined();
        expect(getArgNames(circuit)).toEqual(['coin', 'amount']);
        expect(getResultType(circuit)).toBe('ShieldedSendResult');
        expect(circuit.proof).toBe(true);
    });
});

// ============================================================
// ZKIR CIRCUIT FILE VALIDATION
// ============================================================

describe('ZKIR Circuit Files', () => {
    const managedDir = join(__dirname, '../managed');
    const zkirDir = join(managedDir, 'zkir');

    // nextNonce is pure (no proof needed), so no .zkir file
    const expectedZkirFiles = [
        'createShieldedToken.zkir',
        'mintAndSend.zkir',
        'transferShielded.zkir',
        'burnShieldedToken.zkir',
        'burnByNonce.zkir',
        'depositShielded.zkir',
        'depositAndBurn.zkir',
    ];

    it.each(expectedZkirFiles)('should generate %s as valid JSON', (filename) => {
        const filePath = join(zkirDir, filename);
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, 'utf-8');
        expect(content.length).toBeGreaterThan(0);

        // Verify it's valid JSON with expected structure
        const zkir = JSON.parse(content);
        expect(zkir.version).toBeDefined();
        expect(zkir.instructions).toBeDefined();
        expect(Array.isArray(zkir.instructions)).toBe(true);
    });
});

// ============================================================
// LEDGER STATE LAYOUT TESTS
// ============================================================

describe('Ledger State Layout', () => {
    let contractInfo: any;

    beforeAll(() => {
        const contractInfoPath = join(__dirname, '../managed/compiler/contract-info.json');
        contractInfo = JSON.parse(readFileSync(contractInfoPath, 'utf-8'));
    });

    function getLedgerField(name: string) {
        return contractInfo.ledger.find((f: any) => f.name === name);
    }

    it('totalSupply should be Uint and exported', () => {
        const field = getLedgerField('totalSupply');
        expect(field).toBeDefined();
        expect(field.exported).toBe(true);
        expect(field.storage).toBe('Cell');
        expect(field.type['type-name']).toBe('Uint');
        // maxval = 2^64 - 1
        expect(field.type.maxval).toBe(18446744073709551615);
    });

    it('totalBurned should be Uint<128> and exported', () => {
        const field = getLedgerField('totalBurned');
        expect(field).toBeDefined();
        expect(field.exported).toBe(true);
        expect(field.storage).toBe('Cell');
        expect(field.type['type-name']).toBe('Uint');
        // maxval = 2^128 - 1
        expect(field.type.maxval).toBe(340282366920938463463374607431768211455);
    });

    it('coins should be a Map and exported', () => {
        const field = getLedgerField('coins');
        expect(field).toBeDefined();
        expect(field.exported).toBe(true);
        expect(field.storage).toBe('Map');
        expect(field.key).toBeDefined();
        expect(field.value).toBeDefined();
        expect(field.value.name).toBe('QualifiedShieldedCoinInfo');
    });
});

// ============================================================
// CONTRACT TYPE DEFINITIONS
// ============================================================

describe('Contract Type Definitions', () => {
    it('should generate TypeScript type definitions', () => {
        const typeDefPath = join(__dirname, '../managed/contract/index.d.ts');
        const content = readFileSync(typeDefPath, 'utf-8');

        expect(content.length).toBeGreaterThan(0);
        expect(content).toContain('export');
    });

    it('should generate JavaScript runtime', () => {
        const jsPath = join(__dirname, '../managed/contract/index.js');
        expect(existsSync(jsPath)).toBe(true);
    });

    it('should not expose private coin values publicly', () => {
        const typeDefPath = join(__dirname, '../managed/contract/index.d.ts');
        const typeDefs = readFileSync(typeDefPath, 'utf-8');

        // The ledger should only contain aggregate counters, not individual balances
        expect(typeDefs).not.toContain('publicBalance');
    });
});

// ============================================================
// TUTORIAL INTEGRATION TEST EXAMPLES
// ============================================================

/**
 * These examples demonstrate how the contract would be used
 * in a real dApp with the Midnight JavaScript SDK.
 *
 * NOTE: These are illustrative examples showing the expected API.
 * Actual execution requires a running Midnight node and proof server.
 */
describe('Tutorial Integration Examples (Illustrative)', () => {
    it.skip('EXAMPLE: createShieldedToken should mint a coin to recipient', async () => {
        // const recipient = /* wallet public key */;
        // const amount = 1000n;
        // const result = await contractRuntime.createShieldedToken(
        //     { amount, recipient },
        //     { witnesses: { localNonce: () => randomBytes(32) } }
        // );
        // expect(result.ledgerUpdates.totalSupply).toBe(1000n);
        // expect(result.returnValue).toBeDefined(); // ShieldedCoinInfo
    });

    it.skip('EXAMPLE: mintAndSend should atomically mint and forward', async () => {
        // const recipient = /* wallet public key */;
        // const amount = 500n;
        // const result = await contractRuntime.mintAndSend(
        //     { amount, recipient },
        //     { witnesses: { localNonce: () => randomBytes(32) } }
        // );
        // expect(result.ledgerUpdates.totalSupply).toBe(500n);
        // expect(result.returnValue.change).toBeDefined();
    });

    it.skip('EXAMPLE: transferShielded should spend a coin and create change', async () => {
        // const coin = /* qualified coin from previous tx */;
        // const recipient = /* different wallet */;
        // const amount = 100n;
        // const result = await contractRuntime.transferShielded(
        //     { coin, recipient, amount }
        // );
        // expect(result.returnValue.change).toBeDefined(); // leftover coins
    });

    it.skip('EXAMPLE: burnShieldedToken should reduce circulating supply', async () => {
        // const coin = /* qualified coin to burn */;
        // const amount = 200n;
        // const result = await contractRuntime.burnShieldedToken(
        //     { coin, amount }
        // );
        // expect(result.ledgerUpdates.totalBurned).toBe(200n);
    });

    it.skip('EXAMPLE: depositAndBurn should receive and burn in one tx', async () => {
        // const coin = /* coin received by contract */;
        // const amount = 50n;
        // const result = await contractRuntime.depositAndBurn(
        //     { coin, amount }
        // );
        // expect(result.ledgerUpdates.totalBurned).toBe(50n);
    });
});

// ============================================================
// SECURITY CHECKS
// ============================================================

describe('Security Properties', () => {
    it('should require witnesses for sensitive operations', () => {
        const contractInfoPath = join(__dirname, '../managed/compiler/contract-info.json');
        const contractInfo = JSON.parse(readFileSync(contractInfoPath, 'utf-8'));

        // localNonce witness is required for minting
        const hasLocalNonce = contractInfo.witnesses.some(
            (w: any) => w.name === 'localNonce'
        );
        expect(hasLocalNonce).toBe(true);
    });

    it('should have pure circuits only for nonce derivation', () => {
        const contractInfoPath = join(__dirname, '../managed/compiler/contract-info.json');
        const contractInfo = JSON.parse(readFileSync(contractInfoPath, 'utf-8'));

        // nextNonce is the only pure circuit
        const pureCircuits = contractInfo.circuits.filter((c: any) => c.pure);
        expect(pureCircuits.length).toBe(1);
        expect(pureCircuits[0].name).toBe('nextNonce');
    });

    it('should have proof circuits for all state-mutating operations', () => {
        const contractInfoPath = join(__dirname, '../managed/compiler/contract-info.json');
        const contractInfo = JSON.parse(readFileSync(contractInfoPath, 'utf-8'));

        const proofCircuits = contractInfo.circuits.filter((c: any) => c.proof);
        const proofNames = proofCircuits.map((c: any) => c.name);

        // All mutating operations require proofs
        expect(proofNames).toContain('createShieldedToken');
        expect(proofNames).toContain('mintAndSend');
        expect(proofNames).toContain('transferShielded');
        expect(proofNames).toContain('burnShieldedToken');
        expect(proofNames).toContain('burnByNonce');
        expect(proofNames).toContain('depositAndBurn');
    });
});
