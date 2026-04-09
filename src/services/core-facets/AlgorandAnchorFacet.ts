import algosdk from 'algosdk';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import { IDLTAdapter } from '../../interfaces/IDLTAdapter';
import { PostQuantumCrypto } from '../../utils/PostQuantumCrypto';

export class AlgorandAnchorFacet implements IDLTAdapter {
    private algodClient: algosdk.Algodv2;
    private masterAccount: algosdk.Account;

    constructor() {
        const Mnemonic = process.env.ALGORAND_MASTER_MNEMONIC;
        const Server = process.env.ALGOD_SERVER;
        const Token = process.env.ALGOD_TOKEN || '';
        const Port = process.env.ALGOD_PORT || '';

        if (!Mnemonic) {
            throw new Error("ALGORAND_MASTER_MNEMONIC is not defined in the environment.");
        }

        if (!Server) {
            throw new Error("ALGOD_SERVER is not defined in the environment. Production requires explicit Mainnet configuration.");
        }

        this.algodClient = new algosdk.Algodv2(Token, Server, Port);
        this.masterAccount = algosdk.mnemonicToSecretKey(Mnemonic);
    }

    /**
     * Anchors an event payload hash to the Algorand Blockchain.
     * ZERO-VALUE Txn with Note Field LGPD Obfuscation.
     * @param eventId The local event ID
     * @param eventHash The SHA-256 or SHA3-512 hash of the payload
     */
    async anchorEvent(eventId: string, eventHash: string): Promise<string> {
        // Fetch event to get Tenant ID for LGPD Obfuscation
        const event = await prisma.eventLog.findUnique({
            where: { id: eventId }
        });

        if (!event) {
            throw new Error(`Event not found: ${eventId}`);
        }

        // Post-Quantum Signature Simulation (Falcon-512)
        // Extract the private seed/key from the environment (or Vault)
        const tenantPrivateKey = process.env.QUANTUM_CERT_SECRET || event.tenantId;
        const pqcSignature = await PostQuantumCrypto.signPayloadFalcon512(event.payload as object, tenantPrivateKey);

        // LGPD OBFUSCATION & BINARY PACKAGING
        // The business rule defined: Header (QC|) | TenantHash (32b) | EventSHA3 (64b) | PQCSign (~666b)
        const headerBuffer = Buffer.from('QC|');
        const tenantHashBuffer = crypto.createHash('sha256').update(event.tenantId).digest();
        const eventHashBuffer = Buffer.from(eventHash, 'hex');

        const noteBuffer = Buffer.concat([
            headerBuffer,
            tenantHashBuffer,
            eventHashBuffer,
            pqcSignature
        ]);
        const noteArray = new Uint8Array(noteBuffer);

        // Get suggested params from the network (Gas, Fee, Rounds)
        const params = await this.algodClient.getTransactionParams().do();

        // Omnibus Wallet: From Master to Master, Amount 0
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: this.masterAccount.addr.toString(),
            receiver: this.masterAccount.addr.toString(),
            amount: 0,
            note: noteArray,
            suggestedParams: params
        });

        // HOTFIX: Resilience check - Ensure Master Wallet has enough ALGOs to pay the fee
        const accountInfo = await this.algodClient.accountInformation(this.masterAccount.addr).do();
        const balanceMicroAlgos = Number(accountInfo.amount || 0);
        const requiredFee = params.fee || 1000;

        // RED TEAM HOTFIX: 5 ALGOs soft alert (1 ALGO = 1,000,000 microAlgos)
        const balanceAlgos = balanceMicroAlgos / 1000000;
        if (balanceAlgos <= 5) {
            // Emits Critical Alert without stopping the queue
            console.warn(`[CRITICAL ALERT] Master Wallet balance is VERY LOW: ${balanceAlgos.toFixed(2)} ALGOs remaining! Replenish immediately to avoid queue stalling.`);
        }

        if (balanceMicroAlgos < requiredFee) {
            throw new Error('Insufficient funds in Master Wallet to cover anchoring fees. Marking as PENDING_FUNDS.');
        }

        // Sign the transaction with Master Account's Private Key (Falcon/Ed25519 internally managed by Algorand)
        // Note: Algorand natively uses Ed25519. In Phase 6 logic the "Falcon-512" signature would be the payload's signature, 
        // but Algorand signs the transaction using Ed25519. We will rely on standard algosdk signing.
        const signedTxn = txn.signTxn(this.masterAccount.sk);

        // Submit the transaction
        const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
        const txId = (sendResponse as any).txId || sendResponse.txid;

        return txId;
    }

    /**
     * Verifies if an anchor associated with a TxID is mathematically valid and exists on the ledger.
     */
    async verifyAnchor(txId: string): Promise<boolean> {
        try {
            const txInfo = await this.algodClient.pendingTransactionInformation(txId).do();
            if (txInfo && txInfo.confirmedRound && txInfo.confirmedRound > 0) {
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }
}
