import { describe, it, expect } from 'vitest';

// We test against the real falcon-crypto WASM — no mocks.
describe('PostQuantumCrypto.verifySignatureFalcon512', () => {
  it('returns true for a valid signature', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const falcon = require('falcon-crypto');
    const { publicKey, privateKey } = await falcon.keyPair();
    const message = JSON.stringify({ selector: 'event.recordAuthenticated', assetId: 'a1' });
    const sig = await falcon.signDetached(Buffer.from(message), privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const pubB64 = Buffer.from(publicKey).toString('base64');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(message, sigB64, pubB64);
    expect(result).toBe(true);
  });

  it('returns false for a tampered message', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const falcon = require('falcon-crypto');
    const { publicKey, privateKey } = await falcon.keyPair();
    const message = JSON.stringify({ selector: 'event.recordAuthenticated', assetId: 'a1' });
    const sig = await falcon.signDetached(Buffer.from(message), privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const pubB64 = Buffer.from(publicKey).toString('base64');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(
      message + ' tampered',
      sigB64,
      pubB64
    );
    expect(result).toBe(false);
  });

  it('returns false for a wrong public key', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const falcon = require('falcon-crypto');
    const kp1 = await falcon.keyPair();
    const kp2 = await falcon.keyPair();
    const message = 'hello';
    const sig = await falcon.signDetached(Buffer.from(message), kp1.privateKey);
    const sigB64 = Buffer.from(sig).toString('base64');
    const wrongPubB64 = Buffer.from(kp2.publicKey).toString('base64');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(message, sigB64, wrongPubB64);
    expect(result).toBe(false);
  });

  it('returns false for malformed base64 inputs', async () => {
    const { PostQuantumCrypto } = await import('../src/utils/PostQuantumCrypto');
    const result = await PostQuantumCrypto.verifySignatureFalcon512(
      'msg',
      'not-valid-base64!!!',
      'also-not-valid!!!'
    );
    expect(result).toBe(false);
  });
});
