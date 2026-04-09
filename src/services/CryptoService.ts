import crypto from 'crypto';

export class CryptoService {
    // 32 bytes required for AES-256
    private static getMasterKey(): Buffer {
        const keyString = process.env.DB_ENCRYPTION_KEY || 'default_secret_key_32_bytes_long!';

        // Ensure strictly 32 bytes for AES-256
        const keyBuffer = Buffer.from(keyString, 'utf-8');
        if (keyBuffer.length !== 32) {
            // Hash down or pad up to exactly 32 bytes securely if the developer provides a bad key
            return crypto.createHash('sha256').update(keyString).digest();
        }
        return keyBuffer;
    }

    /**
     * Encrypts a JSON payload symmetrically via AES-256-GCM.
     * Generates a 12-byte initialization vector per operation.
     * Returns the payload in the structured object format.
     */
    static encryptJson(data: any): any {
        if (data === null || data === undefined) return data;

        // If data is already encrypted (e.g. nested calls or re-saves), skip it
        if (data && typeof data === 'object' && data._enc) {
            return data;
        }

        const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
        const iv = crypto.randomBytes(12); // Standard GCM IV length
        const key = this.getMasterKey();

        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

        let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
        ciphertext += cipher.final('base64');
        const authTag = cipher.getAuthTag().toString('base64');

        return {
            _enc: ciphertext,
            iv: iv.toString('base64'),
            tag: authTag
        };
    }

    /**
     * Decrypts an AES-256-GCM structured object.
     * Falls back to returning raw data if it doesn't match the signature.
     */
    static decryptJson(payload: any): any {
        if (!payload || typeof payload !== 'object') {
            return payload; // Primitive or null
        }

        if (!payload._enc || !payload.iv || !payload.tag) {
            return payload; // Not encrypted or legacy raw data
        }

        try {
            const key = this.getMasterKey();
            const iv = Buffer.from(payload.iv, 'base64');
            const authTag = Buffer.from(payload.tag, 'base64');
            const ciphertext = payload._enc;

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            // Attempt to parse back to JSON if it was a structured string, or return the string
            try {
                return JSON.parse(decrypted);
            } catch (e) {
                return decrypted;
            }
        } catch (error) {
            console.error('[CryptoService] Decryption failed! Returning null to prevent leak.', error);
            return null;
        }
    }
}
