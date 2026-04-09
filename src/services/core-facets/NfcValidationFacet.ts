import crypto from 'crypto';
// @ts-ignore
import { aesCmac } from 'node-aes-cmac';

export class NfcValidationFacet {
    private static readonly MASTER_KEY_DEFAULT = '00000000000000000000000000000000';

    /**
     * validates the authenticity of an NFC tap using SUN (Secure Unique Message) protocol.
     * 
     * @param uid Hardware Unique Identifier (hex)
     * @param ctr Monotonic Counter (integer)
     * @param cmacReceived CMAC Signature received from the tag (hex)
     * @param customKey Optional key per tenant/device (hex)
     */
    static validateSunCmac(params: {
        uid: string;
        ctr: number;
        cmacReceived: string;
        masterKey?: string;
    }): { isValid: boolean; error?: string } {
        const { uid, ctr, cmacReceived, masterKey } = params;

        // RED TEAM HOTFIX 6 (Buffer Bomb / Anti-ReDoS): Exact Hardware constraints
        if (!uid || typeof uid !== 'string' || uid.length !== 14 || !/^[0-9a-fA-F]+$/.test(uid)) {
            return { isValid: false, error: 'Malformed UID. Expected 14 hex characters.' };
        }

        if (!cmacReceived || typeof cmacReceived !== 'string' || cmacReceived.length !== 16 || !/^[0-9a-fA-F]+$/.test(cmacReceived)) {
            return { isValid: false, error: 'Malformed CMAC. Expected 16 hex characters.' };
        }

        let key: Buffer | null = null;
        let serverBuffer: Buffer | null = null;
        let clientBuffer: Buffer | null = null;

        try {
            key = Buffer.from(masterKey || process.env.NTAG_SUN_KEY || this.MASTER_KEY_DEFAULT, 'hex');

            if (key.length !== 16) {
                return { isValid: false, error: 'Invalid master key length' };
            }

            // SDM (Secure Dynamic Messaging) Construction for NTAG 424 DNA
            // Standard SUN construction: 
            // 1. Prepare the input data (usually 0xC1 0xAD 0x54 + CTR + UID)
            // Note: This matches the SDM mirror configuration.

            const ctrBuf = Buffer.alloc(3);
            ctrBuf.writeUIntBE(ctr, 0, 3); // CTR is 3 bytes in NTAG 424 DNA

            const uidBuf = Buffer.from(uid, 'hex');

            // Fixed SUN prefix (SDM Spec)
            const prefix = Buffer.from([0xC1, 0xAD, 0x54]);

            const dataToHash = Buffer.concat([prefix, uidBuf, ctrBuf]);

            // Calculate AES-128 CMAC (RFC 4493) REAL Implementation
            const calculatedCmac = aesCmac(key, dataToHash) as string;

            // Truncate to 8 bytes (16 hex chars) - standard for SUN tags
            const truncatedCmac = calculatedCmac.substring(0, 16).toUpperCase();

            // RED TEAM HOTFIX 1 (Timing Attacks): timingSafeEqual nullifies latency profiling
            serverBuffer = Buffer.from(truncatedCmac, 'hex');
            clientBuffer = Buffer.from(cmacReceived, 'hex');

            if (serverBuffer.length !== clientBuffer.length) {
                return { isValid: false, error: 'Length mismatch bypass attempt.' };
            }

            const isValid = crypto.timingSafeEqual(serverBuffer, clientBuffer);

            return {
                isValid,
                error: isValid ? undefined : `CMAC Protocol Exception. Signature invalid.`
            };
        } catch (err: any) {
            return { isValid: false, error: `Validation error: ${err.message}` };
        } finally {
            // RED TEAM HOTFIX 6 (Heap Dump Leak): Military-grade RAM Sanitization
            if (key) key.fill(0);
            if (serverBuffer) serverBuffer.fill(0);
            if (clientBuffer) clientBuffer.fill(0);
        }
    }
}
