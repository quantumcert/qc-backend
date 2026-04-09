const falcon = require('falcon-crypto');
import crypto from 'crypto';

async function main() {
    try {
        console.log("Generating Falcon-512 Keypair (WASM)...");

        const keys = await falcon.keyPair();
        console.log("Keys generated successfully.");
        console.log("Public Key Length:", keys.publicKey.length);
        console.log("Secret Key Length:", keys.privateKey.length);

        const payload = {
            assetId: "12345",
            event: "CERTIFICATE_ISSUED",
            timestamp: new Date().toISOString()
        };

        const message = Buffer.from(JSON.stringify(payload));
        console.log("\nSigning Payload...");

        // Detached signature is often preferred to keep signature and message separate
        const signature = await falcon.signDetached(message, keys.privateKey);

        console.log("Signature created. Length:", signature.length);
        console.log("Signature Hex:", Buffer.from(signature).toString('hex').substring(0, 64) + "...");

        console.log("\nVerifying Signature...");
        const isValid = await falcon.verifyDetached(signature, message, keys.publicKey);

        if (isValid) {
            console.log("Signature Validated Successfully!");
        } else {
            console.log("Signature Validation Failed.");
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
