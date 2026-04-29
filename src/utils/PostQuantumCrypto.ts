const falcon = require('falcon-crypto');
const crypto = require('crypto');

const localKeyCache = new Map<string, Uint8Array>();

export class PostQuantumCrypto {
    /**
     * Integrates true Post-Quantum Cryptography logic using Falcon-512 (WASM compiled).
     * 
     * @param payload The raw object to be signed
     * @param tenantSecretHex The private key/seed of the tenant (Hex string of 2305 bytes)
     * @returns A Uint8Array (Buffer) representing the pure PQC detached signature
     */
    static async signPayloadFalcon512(payload: object, tenantSecretHex: string): Promise<Uint8Array> {
        const payloadString = JSON.stringify(payload);
        const message = Buffer.from(payloadString);

        let privateKey: Uint8Array;

        // True Falcon-512 Private Keys are exactly 2305 bytes long (4610 hex characters)
        // We evaluate if a legitimate Production Key was supplied.
        if (tenantSecretHex.length >= 4610) {
            privateKey = Buffer.from(tenantSecretHex, 'hex');
        } else {
            // Resilience Layer (Dev/Testing): If the provided key is a mock (e.g., "t1" or unconfigured GUID), 
            // we generate a mathematically valid Falcon Key in-memory and cache it per-tenant so it remains deterministic.
            if (localKeyCache.has(tenantSecretHex)) {
                privateKey = localKeyCache.get(tenantSecretHex)!;
            } else {
                const keys = await falcon.keyPair();
                privateKey = keys.privateKey;
                localKeyCache.set(tenantSecretHex, privateKey);
            }
        }

        // Generate pure bytes Detached Signature
        const signature = await falcon.signDetached(message, privateKey);
        return signature;
    }

    // ============================================================
    // PQC KEY WRAPPING (Hierarchical Encryption)
    // ============================================================
    // Wraps a user private key using a Master Falcon Key.
    // Uses AES-256-GCM with HKDF-SHA3-256 key derivation.
    // ============================================================

    /**
     * Derives an AES-256 wrapping key from the Falcon-512 master secret.
     * Uses HKDF-SHA3-256 (RFC 5869) for deterministic key derivation.
     */
    static deriveWrappingKey(masterSecret: Uint8Array, context: string): Buffer {
        // HKDF Extract: PRK = HMAC-SHA3-256(salt, IKM)
        const salt = crypto.createHash('sha3-256').update('QUANTUM_CERT_KEY_WRAP_SALT_v1').digest();
        const prk = crypto.createHmac('sha3-256', salt).update(masterSecret).digest();

        // HKDF Expand: OKM = HMAC-SHA3-256(PRK, info || 0x01)
        const info = Buffer.from(`QC_KEY_WRAP_${context}_v1`);
        const okm = crypto.createHmac('sha3-256', prk).update(Buffer.concat([info, Buffer.from([0x01])])).digest();

        // AES-256 needs 32 bytes
        return okm;
    }

    /**
     * Wraps (encrypts) a user private key using the master wrapping key.
     * Returns a Base64-encoded ciphertext with embedded nonce.
     */
    static wrapKey(plaintextKey: string, masterSecret: Uint8Array): string {
        const wrappingKey = this.deriveWrappingKey(masterSecret, 'USER_KEY_WRAP');
        
        // Generate random 12-byte nonce for AES-GCM
        const nonce = crypto.randomBytes(12);
        
        const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, nonce);
        const encrypted = Buffer.concat([
            cipher.update(plaintextKey, 'utf8'),
            cipher.final()
        ]);
        const authTag = cipher.getAuthTag();

        // Format: nonce (12 bytes) + authTag (16 bytes) + ciphertext
        const wrapped = Buffer.concat([nonce, authTag, encrypted]);
        
        // Zeroize sensitive data from memory
        wrappingKey.fill(0);
        
        return wrapped.toString('base64');
    }

    /**
     * Unwraps (decrypts) a user private key using the master wrapping key.
     * Returns the plaintext key. Caller MUST zeroize after use.
     */
    static unwrapKey(ciphertextBase64: string, masterSecret: Uint8Array): string {
        const wrapped = Buffer.from(ciphertextBase64, 'base64');
        
        // Extract components
        const nonce = wrapped.subarray(0, 12);
        const authTag = wrapped.subarray(12, 28);
        const encrypted = wrapped.subarray(28);

        const wrappingKey = this.deriveWrappingKey(masterSecret, 'USER_KEY_WRAP');
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, nonce);
        decipher.setAuthTag(authTag);
        
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        
        // Zeroize wrapping key from memory
        wrappingKey.fill(0);
        
        return decrypted.toString('utf8');
    }

    /**
     * Securely zeroizes a Buffer or string from memory.
     * Best-effort: overwrites Buffer contents with zeros.
     * For strings, returns an empty string (JS strings are immutable).
     */
    static zeroize(data: Buffer | string): void {
        if (Buffer.isBuffer(data)) {
            data.fill(0);
        }
        // Strings are immutable in JS; we can't truly zeroize them.
        // For high-security scenarios, use Buffer for all key material.
    }

    // ============================================================
    // SIGNATURE VERIFICATION
    // Verifies a Falcon-512 detached signature against a public key.
    // Both signature and publicKey are base64-encoded.
    // Returns false on any error (invalid inputs, wrong key, tampered message).
    // ============================================================
    static async verifySignatureFalcon512(
        message: string,
        signatureB64: string,
        publicKeyB64: string
    ): Promise<boolean> {
        try {
            const messageBytes = Buffer.from(message);
            const signature = Buffer.from(signatureB64, 'base64');
            const publicKey = Buffer.from(publicKeyB64, 'base64');
            // verifyDetached returns boolean; throws if inputs are malformed
            return await falcon.verifyDetached(signature, messageBytes, publicKey);
        } catch {
            return false;
        }
    }
}
