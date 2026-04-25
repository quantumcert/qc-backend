import { describe, it, expect, vi } from 'vitest';
import { QuantumSignerService } from '../../src/services/QuantumSignerService';

describe('Triple-Signature Protocol', () => {
    it('verifyTriple validates a valid TripleSignPayload', async () => {
        const qss = QuantumSignerService.getInstance();
        const signResult = await qss.signTriple(
            {
                sellerAddress: '0xSELLER',
                buyerAddress: '0xBUYER',
                amount: '1000000000000000000',
                txRef: 'tx_ref_001',
            },
            'seller_signature_test',
            'buyer_signature_test',
            'test_dev_key'
        );
        const result = await qss.verifyTriple(signResult);
        expect(result.valid).toBe(true);
    });

    it('verifyTriple rejects duplicate addresses', async () => {
        const qss = QuantumSignerService.getInstance();
        const result = await qss.verifyTriple({
            signatures: {
                sellerSig: 'sig1',
                buyerSig: 'sig2',
                quantumSeal: 'sig3',
                shieldedTimestamp: Date.now(),
                aggregatedHash: 'hash',
            },
            payload: {
                sellerAddress: '0xSAME',
                buyerAddress: '0xSAME',
                amount: '100',
                txRef: 'tx_ref_dup',
            },
            quantumValidated: true,
            validatedAt: Date.now(),
        });
        expect(result.valid).toBe(false);
    });

    it('verifyTriple rejects missing signatures', async () => {
        const qss = QuantumSignerService.getInstance();
        const result = await qss.verifyTriple({
            signatures: {
                sellerSig: '',
                buyerSig: 'sig2',
                quantumSeal: 'sig3',
                shieldedTimestamp: Date.now(),
                aggregatedHash: 'hash',
            },
            payload: {
                sellerAddress: '0xSELLER',
                buyerAddress: '0xBUYER',
                amount: '100',
                txRef: 'tx_ref_missing',
            },
            quantumValidated: true,
            validatedAt: Date.now(),
        });
        expect(result.valid).toBe(false);
    });

    it('verifyTriple rejects future timestamp', async () => {
        const qss = QuantumSignerService.getInstance();
        const result = await qss.verifyTriple({
            signatures: {
                sellerSig: 'sig1',
                buyerSig: 'sig2',
                quantumSeal: 'sig3',
                shieldedTimestamp: Date.now() + 100000,
                aggregatedHash: 'hash',
            },
            payload: {
                sellerAddress: '0xSELLER',
                buyerAddress: '0xBUYER',
                amount: '100',
                txRef: 'tx_ref_future',
            },
            quantumValidated: true,
            validatedAt: Date.now(),
        });
        expect(result.valid).toBe(false);
    });

    it('signTriple returns all three signatures', async () => {
        const qss = QuantumSignerService.getInstance();
        const result = await qss.signTriple(
            {
                sellerAddress: '0xSELLER',
                buyerAddress: '0xBUYER',
                amount: '1000000000000000000',
                txRef: 'tx_ref_sign',
            },
            'seller_signature_hex',
            'buyer_signature_hex',
            'test_dev_key'
        );
        expect(result).toBeDefined();
        expect(result.signatures.sellerSig).toBeDefined();
        expect(result.signatures.buyerSig).toBeDefined();
        expect(result.signatures.quantumSeal).toBeDefined();
        expect(result.quantumValidated).toBe(true);
    });
});

