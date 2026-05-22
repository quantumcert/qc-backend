// ============================================================
// ALGORAND ADAPTER -- Full-Featured Multi-Chain Adapter
// Uses algosdk for all blockchain interactions.
// Supports: ASA Creation/Management, Anchoring, Asset Transfers,
// Atomic Transfers, Opt-in, Escrow (TEAL placeholders)
//
// DEFAULT ANCHORING CHAIN: Algorand is the primary high-speed,
// low-cost anchoring network for Quantum Cert.
//
// HYBRID SIGNATURE:
//   - pqcProof embedded in transaction note field
//   - tripleSign validated before transaction execution
//   - Classical EdDSA via algosdk.Account for transport
// ============================================================

import algosdk from 'algosdk';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import { KMSService } from '../KMSService';
import { QuantumSignerService } from '../QuantumSignerService';
import {
  IDLTAdapter,
  AnchorOptions,
  TransferParams,
  ReceiveParams,
  DLTTransitionPayload,
  EscrowParams,
} from '../../interfaces/IDLTAdapter';

import { TripleSignPayload } from './types';

export class AlgorandAdapter implements IDLTAdapter {
  async executeGenericTransition(payload: DLTTransitionPayload): Promise<string> {
    switch (payload.operation) {
      case 'LOCK': {
        return this.createEscrow({
          escrowId: payload.transitionId,
          sender: payload.sender,
          receiver: payload.receiver,
          amount: payload.amount,
          assetAddress: payload.assetAddress,
          unlockTimestamp: payload.unlockTimestamp,
          pqcProof: payload.pqcProof,
          tripleSign: payload.tripleSign,
        });
      }
      case 'RELEASE': {
        return this.releaseEscrow(payload.transitionId, payload.transitionId);
      }
      case 'CANCEL': {
        return this.cancelEscrow(payload.transitionId, payload.transitionId);
      }
      default:
        throw new Error(`Unsupported operation ${(payload as any).operation}`);
    }
  }

  private algodClient: algosdk.Algodv2;
  private masterAccount: algosdk.Account;
  private quantumSigner: QuantumSignerService;

  constructor() {
    const kms = KMSService.getInstance();
    const mnemonic = kms.getKey('ALGORAND', 'mnemonic');
    const server = kms.getKey('ALGORAND', 'rpcUrl');
    let token: string;
    try {
      token = kms.getKey('ALGORAND', 'apiToken');
    } catch {
      token = '';
    }
    const port = process.env.ALGOD_PORT || '';

    this.algodClient = new algosdk.Algodv2(token, server, port);
    this.masterAccount = algosdk.mnemonicToSecretKey(mnemonic);
    this.quantumSigner = QuantumSignerService.getInstance();
  }

  // ----------------------------------------------------------
  // ANCHOR -- Optimized for high-speed, low-cost anchoring
  // ----------------------------------------------------------

  async anchorEvent(eventId: string, hash: string, options?: AnchorOptions): Promise<string> {
    if (options?.tripleSign) {
      const validation = await this.quantumSigner.verifyTriple(options.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    const hashBuf = Buffer.from(hash.replace(/^0x/, ''), 'hex');
    const headerBuffer = Buffer.from('QC|');
    const tenantHashBuffer = crypto.createHash('sha256').update('SYSTEM').digest();

    const noteParts = [headerBuffer, tenantHashBuffer, hashBuf];
    if (options?.pqcProof) {
      noteParts.push(Buffer.from(options.pqcProof));
    }
    if (options?.tripleSign) {
      noteParts.push(Buffer.from(JSON.stringify(options.tripleSign.signatures)));
    }
    const noteBuffer = Buffer.concat(noteParts);
    const noteArray = new Uint8Array(noteBuffer);

    const params = await this.algodClient.getTransactionParams().do();

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.masterAccount.addr.toString(),
      receiver: this.masterAccount.addr.toString(),
      amount: 0,
      note: noteArray,
      suggestedParams: params,
    });

    const accountInfo = await this.algodClient.accountInformation(this.masterAccount.addr).do();
    const balanceMicroAlgos = Number(accountInfo.amount || 0);
    const requiredFee = params.fee || 1000;

    if (balanceMicroAlgos < requiredFee) {
      throw new Error('Insufficient funds in Master Wallet to cover anchoring fees.');
    }

    const signedTxn = txn.signTxn(this.masterAccount.sk);
    const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
    const txId = (sendResponse as any).txId || sendResponse.txid;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: eventId,
      chain: 'ALGORAND',
      direction: 'ANCHOR',
      chainTxId: txId,
      status: 'PENDING',
      metadata: { hash, pqcProof: options?.pqcProof, tripleSign: options?.tripleSign },
    });

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

  // ----------------------------------------------------------
  // ESCROW
  // ----------------------------------------------------------

  async createEscrow(params: EscrowParams): Promise<string> {
    if (params.tripleSign) {
      const validation = await this.quantumSigner.verifyTriple(params.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    const { escrowId, receiver, amount, unlockTimestamp = 0, pqcProof, tripleSign } = params;

    const noteBuffer = Buffer.from(`ESCROW|${escrowId}|${unlockTimestamp}`);
    const paramsTx = await this.algodClient.getTransactionParams().do();

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.masterAccount.addr.toString(),
      receiver,
      amount: BigInt(amount),
      note: new Uint8Array(noteBuffer),
      suggestedParams: paramsTx,
    });

    const signedTxn = txn.signTxn(this.masterAccount.sk);
    const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
    const txId = (sendResponse as any).txId || sendResponse.txid;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: escrowId,
      chain: 'ALGORAND',
      direction: 'ESCROW_CREATE',
      fromAddress: this.masterAccount.addr.toString(),
      toAddress: receiver,
      amount,
      chainTxId: txId,
      status: 'PENDING',
      metadata: { unlockTimestamp, pqcProof, tripleSign },
    });

    return txId;
  }

  async releaseEscrow(_escrowId: string, _txRef: string): Promise<string> {
    throw new Error(
      'Algorand escrow release requires TEAL smart contract deployment. ' +
      'Use createEscrow with tripleSign for now.'
    );
  }

  async cancelEscrow(_escrowId: string, _txRef: string): Promise<string> {
    throw new Error(
      'Algorand escrow cancellation requires TEAL smart contract deployment.'
    );
  }

  // ----------------------------------------------------------
  // SEND / RECEIVE
  // ----------------------------------------------------------

  async sendAsset(params: TransferParams): Promise<string> {
    if (params.tripleSign) {
      const validation = await this.quantumSigner.verifyTriple(params.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    const { to, amount, txRef, pqcProof, tripleSign, assetAddress } = params;

    const paramsTx = await this.algodClient.getTransactionParams().do();

    let txn: algosdk.Transaction;

    if (assetAddress) {
      const assetIndex = parseInt(assetAddress, 10);
      txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: this.masterAccount.addr.toString(),
        receiver: to,
        amount: BigInt(amount),
        assetIndex,
        suggestedParams: paramsTx,
      });
    } else {
      const noteBuffer = Buffer.from(`TRANSFER|${txRef}`);
      if (pqcProof) {
        noteBuffer.fill(Buffer.from(pqcProof), noteBuffer.length);
      }

      txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: this.masterAccount.addr.toString(),
        receiver: to,
        amount: BigInt(amount),
        note: new Uint8Array(noteBuffer),
        suggestedParams: paramsTx,
      });
    }

    const signedTxn = txn.signTxn(this.masterAccount.sk);
    const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
    const txId = (sendResponse as any).txId || sendResponse.txid;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'ALGORAND',
      direction: 'SEND',
      fromAddress: this.masterAccount.addr.toString(),
      toAddress: to,
      amount,
      assetAddress: assetAddress || null,
      chainTxId: txId,
      status: 'PENDING',
      metadata: { pqcProof, tripleSign },
    });

    return txId;
  }

  async receiveAsset(params: ReceiveParams): Promise<string> {
    const { from, expectedAmount, txRef, pqcProof, tripleSign } = params;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'ALGORAND',
      direction: 'RECEIVE',
      fromAddress: from,
      toAddress: this.masterAccount.addr.toString(),
      amount: expectedAmount,
      status: 'PENDING',
      metadata: { note: 'Receiving verification -- scan for incoming transfers', pqcProof, tripleSign },
    });

    return `RECEIVE_${txRef}`;
  }

  // ----------------------------------------------------------
  // ATOMIC TRANSFERS
  // ----------------------------------------------------------

  async executeAtomicTransfer(
    transactions: Array<{
      to: string;
      amount: string;
      assetAddress?: string;
      note?: string;
    }>
  ): Promise<string> {
    const params = await this.algodClient.getTransactionParams().do();

    const txns: algosdk.Transaction[] = transactions.map((tx) => {
      if (tx.assetAddress) {
        return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: this.masterAccount.addr.toString(),
          receiver: tx.to,
          amount: BigInt(tx.amount),
          assetIndex: parseInt(tx.assetAddress, 10),
          note: tx.note ? new Uint8Array(Buffer.from(tx.note)) : undefined,
          suggestedParams: params,
        });
      }
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: this.masterAccount.addr.toString(),
        receiver: tx.to,
        amount: BigInt(tx.amount),
        note: tx.note ? new Uint8Array(Buffer.from(tx.note)) : undefined,
        suggestedParams: params,
      });
    });

    algosdk.assignGroupID(txns);
    const signedTxns = txns.map((txn) => txn.signTxn(this.masterAccount.sk));

    const sendResponse = await this.algodClient.sendRawTransaction(signedTxns).do();
    return (sendResponse as any).txId || sendResponse.txid;
  }

  // ----------------------------------------------------------
  // OPT-IN
  // ----------------------------------------------------------

  async createOptInTransaction(userAddress: string, assetIndex: number): Promise<Uint8Array> {
    const params = await this.algodClient.getTransactionParams().do();

    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: userAddress,
      receiver: userAddress,
      amount: BigInt(0),
      assetIndex,
      suggestedParams: params,
    });

    return txn.toByte();
  }

  async hasOptedIn(address: string, assetIndex: number): Promise<boolean> {
    try {
      const accountInfo = await this.algodClient.accountInformation(address).do();
      const assets = accountInfo.assets || [];
      return assets.some((asset: any) => asset['asset-id'] === assetIndex);
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------
  // ASA MANAGEMENT
  // ----------------------------------------------------------

  async createASA(
    assetName: string,
    unitName: string,
    totalSupply: bigint,
    decimals: number,
    _metadataHash?: string
  ): Promise<number> {
    const params = await this.algodClient.getTransactionParams().do();

    const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
      sender: this.masterAccount.addr.toString(),
      total: totalSupply,
      decimals,
      assetName,
      unitName,
      suggestedParams: params,
    });

    const signedTxn = txn.signTxn(this.masterAccount.sk);
    const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
    const txId = (sendResponse as any).txId || sendResponse.txid;

    const ptx = await this.algodClient.pendingTransactionInformation(txId).do();
    const assetIndex = ptx.assetIndex;

    if (!assetIndex) {
      throw new Error('ASA creation failed: no assetIndex returned');
    }

    return Number(assetIndex);
  }

  async configureASA(
    assetIndex: number,
    options: {
      manager?: string;
      reserve?: string;
      freeze?: string;
      clawback?: string;
    }
  ): Promise<string> {
    const params = await this.algodClient.getTransactionParams().do();

    const txn = algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({
      sender: this.masterAccount.addr.toString(),
      assetIndex,
      manager: options.manager,
      reserve: options.reserve,
      freeze: options.freeze,
      clawback: options.clawback,
      suggestedParams: params,
      strictEmptyAddressChecking: false,
    });

    const signedTxn = txn.signTxn(this.masterAccount.sk);
    const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
    return (sendResponse as any).txId || sendResponse.txid;
  }

  async freezeASA(assetIndex: number, targetAddress: string, frozen: boolean): Promise<string> {
    const params = await this.algodClient.getTransactionParams().do();

    const txn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
      sender: this.masterAccount.addr.toString(),
      assetIndex,
      freezeTarget: targetAddress,
      frozen,
      suggestedParams: params,
    });

    const signedTxn = txn.signTxn(this.masterAccount.sk);
    const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
    return (sendResponse as any).txId || sendResponse.txid;
  }

  async destroyASA(assetIndex: number): Promise<string> {
    const params = await this.algodClient.getTransactionParams().do();

    const txn = algosdk.makeAssetDestroyTxnWithSuggestedParamsFromObject({
      sender: this.masterAccount.addr.toString(),
      assetIndex,
      suggestedParams: params,
    });

    const signedTxn = txn.signTxn(this.masterAccount.sk);
    const sendResponse = await this.algodClient.sendRawTransaction(signedTxn).do();
    return (sendResponse as any).txId || sendResponse.txid;
  }

  // ----------------------------------------------------------
  // TEAL ESCROW PLACEHOLDER
  // ----------------------------------------------------------

  generateTripleSigEscrowTEAL(sellerAddress: string, buyerAddress: string, _quantumPublicKey: string): string {
    return `
#pragma version 6
// Triple-Signature Escrow Contract for Quantum Cert
txn TypeEnum
int pay
==
txn Sender
addr ${sellerAddress}
!=
txn Receiver
addr ${buyerAddress}
==
&&
&&
return
    `.trim();
  }

  // ----------------------------------------------------------
  // PRISMA LOGGING
  // ----------------------------------------------------------

  private async logTransaction(data: {
    tenantId: string;
    txRef: string;
    chain: string;
    direction: string;
    fromAddress?: string;
    toAddress?: string;
    amount?: string;
    assetAddress?: string | null;
    chainTxId?: string;
    status: string;
    metadata?: Record<string, unknown>;
    error?: string;
  }) {
    try {
      await prisma.chainTransaction.create({ data: data as any });
    } catch (err) {
      console.error('[AlgorandAdapter] Failed to log transaction to Prisma:', err);
    }
  }
}
