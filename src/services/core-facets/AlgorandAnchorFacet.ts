import algosdk from 'algosdk';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import {
    IDLTAdapter,
    AnchorOptions,
    DLTTransitionPayload,
    EscrowParams,
    TransferParams,
    ReceiveParams,
} from '../../interfaces/IDLTAdapter';
import { KMSService } from '../KMSService';
import { QuantumSignerService } from '../QuantumSignerService';

export class AlgorandAnchorFacet implements IDLTAdapter {
    private algodClient: algosdk.Algodv2;
    private masterAccount: algosdk.Account;

    constructor() {
        const kms = KMSService.getInstance();
        const mnemonic = kms.getKey('ALGORAND', 'mnemonic');
        const server = kms.getKey('ALGORAND', 'rpcUrl');
        const token = kms.getKey('ALGORAND', 'apiToken') || '';
        const port = process.env.ALGOD_PORT || '';

        this.algodClient = new algosdk.Algodv2(token, server, port);
        this.masterAccount = algosdk.mnemonicToSecretKey(mnemonic);
    }

    /**
     * Anchors an event payload hash to the Algorand Blockchain.
     * ZERO-VALUE Txn with Note Field LGPD Obfuscation.
     * Includes Falcon-512 PQC proof via QuantumSignerService.
     * @param eventId The local event ID
     * @param eventHash The SHA-256 or SHA3-512 hash of the payload
     * @param options Optional chain-specific anchoring parameters (pqcProof, unlockTimestamp)
     */
    async anchorEvent(eventId: string, eventHash: string, options?: AnchorOptions): Promise<string> {
        const event = await prisma.eventLog.findUnique({
            where: { id: eventId }
        });

        if (!event) {
            throw new Error(`Event not found: ${eventId}`);
        }

        // Resolve PQC proof: use provided options or generate via QuantumSignerService
        let pqcProofBase64: string;
        if (options?.pqcProof) {
            pqcProofBase64 = options.pqcProof;
        } else {
            const qss = QuantumSignerService.getInstance();
            const tenantSecret = Buffer
                .from(KMSService.getInstance().getQuantumMasterKey())
                .toString('hex');
            pqcProofBase64 = await qss.signPayloadRaw(
                { eventId, hash: eventHash, tenantId: event.tenantId },
                eventId,
                'EVENT',
                tenantSecret
            );
        }

        // LGPD OBFUSCATION & BINARY PACKAGING
        const headerBuffer = Buffer.from('QC|');
        const tenantHashBuffer = crypto.createHash('sha256').update(event.tenantId).digest();
        const eventHashBuffer = Buffer.from(eventHash, 'hex');
        const pqcBuffer = Buffer.from(pqcProofBase64);

        const noteBuffer = Buffer.concat([
            headerBuffer,
            tenantHashBuffer,
            eventHashBuffer,
            pqcBuffer
        ]);
        const noteArray = new Uint8Array(noteBuffer);

        const params = await this.algodClient.getTransactionParams().do();

        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: this.masterAccount.addr.toString(),
            receiver: this.masterAccount.addr.toString(),
            amount: 0,
            note: noteArray,
            suggestedParams: params
        });

        const accountInfo = await this.algodClient.accountInformation(this.masterAccount.addr).do();
        const balanceMicroAlgos = Number(accountInfo.amount || 0);
        const requiredFee = params.fee || 1000;
        const balanceAlgos = balanceMicroAlgos / 1000000;

        if (balanceAlgos <= 5) {
            console.warn(`[CRITICAL ALERT] Master Wallet balance is VERY LOW: ${balanceAlgos.toFixed(2)} ALGOs remaining! Replenish immediately to avoid queue stalling.`);
        }

        if (balanceMicroAlgos < requiredFee) {
            throw new Error('Insufficient funds in Master Wallet to cover anchoring fees. Marking as PENDING_FUNDS.');
        }

        const signedTxn = txn.signTxn(this.masterAccount.sk);
        const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
        const txId = (sendResponse as any).txId || sendResponse.txid;

        // SEC-06: Record anchor transaction in ChainTransaction with tenantId always populated.
        // tenantId comes from the EventLog — it is NEVER provided by the caller (prevents cross-tenant drift).
        try {
            await prisma.chainTransaction.create({
                data: {
                    tenantId: event.tenantId,
                    txRef: eventId,
                    chain: 'ALGORAND',
                    direction: 'ANCHOR',
                    chainTxId: txId,
                    fromAddress: this.masterAccount.addr.toString(),
                    toAddress: this.masterAccount.addr.toString(),
                    amount: '0',
                    status: 'CONFIRMED',
                    metadata: {
                        eventId,
                        eventHash,
                        pqcProofLength: pqcProofBase64.length,
                    },
                },
            });
        } catch (logErr: any) {
            // Logging failure must not abort the anchor operation — log and continue.
            console.error('[AlgorandAnchorFacet] Failed to log ChainTransaction:', logErr.message);
        }

        return txId;
    }

    async verifyAnchor(txId: string, _expectedHash?: string): Promise<boolean> {
        try {
            const txInfo = await this.algodClient.pendingTransactionInformation(txId).do();
            if (txInfo && txInfo.confirmedRound && txInfo.confirmedRound > 0) {
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────
    // ESCROW -- Delegated to AlgorandAdapter
    // ─────────────────────────────────────────────────────────

    async executeGenericTransition(payload: DLTTransitionPayload): Promise<string> {
        const { AlgorandAdapter } = await import('../multi-chain/AlgorandAdapter');
        const adapter = new AlgorandAdapter();
        return adapter.executeGenericTransition(payload);
    }

    async createEscrow(params: EscrowParams): Promise<string> {
        const { AlgorandAdapter } = await import('../multi-chain/AlgorandAdapter');
        const adapter = new AlgorandAdapter();
        return adapter.createEscrow(params);
    }

    async releaseEscrow(escrowId: string, txRef: string): Promise<string> {
        throw new Error('Algorand escrow release requires TEAL smart contract. Not yet implemented.');
    }

    async cancelEscrow(escrowId: string, txRef: string): Promise<string> {
        throw new Error('Algorand escrow cancellation requires TEAL smart contract. Not yet implemented.');
    }

    // ─────────────────────────────────────────────────────────
    // SEND / RECEIVE -- Delegated to AlgorandAdapter
    // ─────────────────────────────────────────────────────────

    async sendAsset(params: TransferParams): Promise<string> {
        const { AlgorandAdapter } = await import('../multi-chain/AlgorandAdapter');
        const adapter = new AlgorandAdapter();
        return adapter.sendAsset(params);
    }

    async receiveAsset(params: ReceiveParams): Promise<string> {
        const { AlgorandAdapter } = await import('../multi-chain/AlgorandAdapter');
        const adapter = new AlgorandAdapter();
        return adapter.receiveAsset(params);
    }
}
