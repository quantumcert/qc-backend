/**
 * TDD RED phase — QuantumSignerService.verifySignature (SEC-02)
 *
 * These tests verify that verifySignature delegates to the real
 * Falcon-512 cryptographic implementation via PostQuantumCrypto,
 * instead of the stub `return true`.
 */
import { describe, it, expect } from 'vitest';
import { QuantumSignerService } from '../src/services/QuantumSignerService';

describe('QuantumSignerService.verifySignature (SEC-02)', () => {
  it('returns true for a valid Falcon-512 signature', async () => {
    const falcon = require('falcon-crypto');
    const { publicKey, privateKey } = await falcon.keyPair();
    const payload = { action: 'PAUSE', chain: 'ALGORAND' };
    const message = JSON.stringify(payload);
    const sig = await falcon.signDetached(Buffer.from(message), privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const pubHex = Buffer.from(publicKey).toString('hex');

    const signer = QuantumSignerService.getInstance();
    const result = await signer.verifySignature(payload, sigB64, pubHex);
    expect(result).toBe(true);
  });

  it('returns false for an invalid (forged) signature', async () => {
    const falcon = require('falcon-crypto');
    const { publicKey } = await falcon.keyPair();
    const payload = { action: 'PAUSE', chain: 'ALGORAND' };
    const forgedSig = Buffer.from('this-is-a-forged-signature').toString('base64');
    const pubHex = Buffer.from(publicKey).toString('hex');

    const signer = QuantumSignerService.getInstance();
    const result = await signer.verifySignature(payload, forgedSig, pubHex);
    expect(result).toBe(false);
  });

  it('returns false when public key does not match the signing key', async () => {
    const falcon = require('falcon-crypto');
    const kp1 = await falcon.keyPair();
    const kp2 = await falcon.keyPair();
    const payload = { action: 'PAUSE', chain: 'ALGORAND' };
    const message = JSON.stringify(payload);
    const sig = await falcon.signDetached(Buffer.from(message), kp1.privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const wrongPubHex = Buffer.from(kp2.publicKey).toString('hex');

    const signer = QuantumSignerService.getInstance();
    const result = await signer.verifySignature(payload, sigB64, wrongPubHex);
    expect(result).toBe(false);
  });

  it('does not throw when given malformed inputs — returns false instead', async () => {
    const signer = QuantumSignerService.getInstance();
    const result = await signer.verifySignature({}, 'not!!valid!!base64', 'also!!not!!hex');
    expect(result).toBe(false);
  });
});
