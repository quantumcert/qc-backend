// ============================================================
// SOROBAN ADAPTER -- Stellar Soroban Smart Contract Integration
// Uses @stellar/stellar-sdk for all blockchain interactions.
// Supports: Payment (Escrow), Receiving, Sending, Anchoring
// SECURITY: Classic Memo is BANNED (28b limit < 64b SHA3-512).
//           Always uses Soroban contract invocation.
//
// HYBRID SIGNATURE:
//   - pqcProof embedded in Soroban contract invocation args
//   - Classical EdDSA via Keypair for transport
// ============================================================

import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  Contract,
  nativeToScVal,
  rpc as SorobanRpc,
  Transaction,
} from '@stellar/stellar-sdk';
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


export class SorobanAdapter implements IDLTAdapter {
  async executeGenericTransition(payload: DLTTransitionPayload): Promise<string> {
    switch (payload.operation) {
      case 'LOCK': {
        const params: EscrowParams = {
          escrowId: payload.transitionId,
          sender: payload.sender,
          receiver: payload.receiver,
          amount: payload.amount,
          assetAddress: payload.assetAddress,
          unlockTimestamp: payload.unlockTimestamp ?? 0,

          pqcProof: payload.pqcProof,
          tripleSign: payload.tripleSign,
        };
        return this.createEscrow(params);
      }
      case 'RELEASE':
        return this.releaseEscrow(payload.transitionId, payload.transitionId);
      case 'CANCEL':
        return this.cancelEscrow(payload.transitionId, payload.transitionId);
      default:
        throw new Error(`Unsupported operation ${(payload as any).operation}`);
    }
  }

  private horizonServer: Horizon.Server;

  private sorobanServer: InstanceType<typeof SorobanRpc.Server>;
  private keypair: Keypair;
  private contractId: string;
  private networkPassphrase: string;

  constructor() {
    const kms = KMSService.getInstance();
    const horizonUrl = kms.getKey('STELLAR', 'rpcUrl');
    const sorobanRpcUrl = process.env.STELLAR_SOROBAN_RPC_URL;
    const secretKey = kms.getKey('STELLAR', 'secretKey');
    const contractId = process.env.STELLAR_ANCHOR_CONTRACT_ID;
    const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.PUBLIC;

    if (!horizonUrl) {
      throw new Error('STELLAR_HORIZON_URL is not defined in the environment.');
    }
    if (!sorobanRpcUrl) {
      throw new Error('STELLAR_SOROBAN_RPC_URL is not defined in the environment.');
    }
    if (!secretKey) {
      throw new Error('STELLAR_AUTHORITY_SECRET_KEY is not defined in the environment.');
    }
    if (!contractId) {
      throw new Error('STELLAR_ANCHOR_CONTRACT_ID is not defined in the environment.');
    }

    this.horizonServer = new Horizon.Server(horizonUrl);
    this.sorobanServer = new SorobanRpc.Server(sorobanRpcUrl);
    this.keypair = Keypair.fromSecret(secretKey);
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
  }

  // ----------------------------------------------------------
  // ANCHOR
  // ----------------------------------------------------------

  async anchorEvent(eventId: string, hash: string, options?: AnchorOptions): Promise<string> {
    if (options?.tripleSign) {
      const validation = await QuantumSignerService.getInstance().verifyTriple(options.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    const hashBuf = Buffer.from(hash.replace(/^0x/, ''), 'hex');
    if (hashBuf.length !== 64 && hashBuf.length !== 32) {
      throw new Error(`Invalid hash length: ${hashBuf.length}. Expected 32 or 64 bytes.`);
    }
    const hash64 = hashBuf.length === 64 ? hashBuf : Buffer.concat([hashBuf, Buffer.alloc(32)]);

    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const args = this._toScValArgs(eventId, hash64, options?.unlockTimestamp ?? 0);
    if (options?.pqcProof) {
      args.push(nativeToScVal(options.pqcProof, { type: 'string' }));
    }

    const builder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('anchor_event', ...args));

    const tx = builder.build();
    tx.sign(this.keypair);

    const simulateResult = await this.sorobanServer.simulateTransaction(tx);
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult) as any;
    preparedTx.sign(this.keypair);

    const submitResult = await this.sorobanServer.sendTransaction(preparedTx);

    if (submitResult.status === 'ERROR') {
      throw new Error(`Soroban anchor failed: ${submitResult.status}`);
    }

    const txHash = submitResult.hash;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: eventId,
      chain: 'STELLAR',
      direction: 'ANCHOR',
      chainTxId: txHash,
      status: 'PENDING',
      metadata: { hash, pqcProof: options?.pqcProof, tripleSign: options?.tripleSign },
    });

    return txHash;
  }

  async verifyAnchor(txId: string, _expectedHash?: string): Promise<boolean> {
    try {
      const result = await this.sorobanServer.getTransaction(txId);
      return result.status === 'SUCCESS';
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------
  // ESCROW
  // ----------------------------------------------------------

  async createEscrow(params: EscrowParams): Promise<string> {
    if (params.tripleSign) {
      const validation = await QuantumSignerService.getInstance().verifyTriple(params.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    const { escrowId, receiver, amount, unlockTimestamp, pqcProof, tripleSign } = params;

    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const args = this._toScValEscrowArgs(escrowId, receiver, amount, params.assetAddress, unlockTimestamp);
    if (pqcProof) {
      args.push(nativeToScVal(pqcProof, { type: 'string' }));
    }

    const builder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('create_escrow', ...args));

    const tx = builder.build();
    tx.sign(this.keypair);

    const simulateResult = await this.sorobanServer.simulateTransaction(tx);
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult) as any;
    preparedTx.sign(this.keypair);

    const submitResult = await this.sorobanServer.sendTransaction(preparedTx);

    if (submitResult.status === 'ERROR') {
      throw new Error(`Soroban createEscrow failed: ${submitResult.status}`);
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: escrowId,
      chain: 'STELLAR',
      direction: 'ESCROW_CREATE',
      fromAddress: this.keypair.publicKey(),
      toAddress: receiver,
      amount,
      chainTxId: submitResult.hash,
      status: 'PENDING',
      metadata: { unlockTimestamp, pqcProof, tripleSign },
    });

    return submitResult.hash;
  }

  async releaseEscrow(escrowId: string, txRef: string): Promise<string> {
    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const builder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('release_escrow', ...this._toScValEscrowId(escrowId)));

    const tx = builder.build();
    tx.sign(this.keypair);

    const simulateResult = await this.sorobanServer.simulateTransaction(tx);
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult) as any;
    preparedTx.sign(this.keypair);

    const submitResult = await this.sorobanServer.sendTransaction(preparedTx);

    if (submitResult.status === 'ERROR') {
      throw new Error(`Soroban releaseEscrow failed: ${submitResult.status}`);
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'ESCROW_RELEASE',
      chainTxId: submitResult.hash,
      status: 'PENDING',
      metadata: { escrowId },
    });

    return submitResult.hash;
  }

  async cancelEscrow(escrowId: string, txRef: string): Promise<string> {
    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const builder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('cancel_escrow', ...this._toScValEscrowId(escrowId)));

    const tx = builder.build();
    tx.sign(this.keypair);

    const simulateResult = await this.sorobanServer.simulateTransaction(tx);
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult) as any;
    preparedTx.sign(this.keypair);

    const submitResult = await this.sorobanServer.sendTransaction(preparedTx);

    if (submitResult.status === 'ERROR') {
      throw new Error(`Soroban cancelEscrow failed: ${submitResult.status}`);
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'ESCROW_CANCEL',
      chainTxId: submitResult.hash,
      status: 'PENDING',
      metadata: { escrowId },
    });

    return submitResult.hash;
  }

  // ----------------------------------------------------------
  // SEND / RECEIVE
  // ----------------------------------------------------------

  async sendAsset(params: TransferParams): Promise<string> {
    if (params.tripleSign) {
      const validation = await QuantumSignerService.getInstance().verifyTriple(params.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    const { to, amount, txRef, pqcProof, tripleSign } = params;

    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());

    const builder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(
        Operation.payment({
          destination: to,
          asset: Asset.native(),
          amount,
        })
      );

    const tx = builder.build();
    tx.sign(this.keypair);

    const result = await this.horizonServer.submitTransaction(tx);

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'SEND',
      fromAddress: this.keypair.publicKey(),
      toAddress: to,
      amount,
      chainTxId: result.hash,
      status: 'CONFIRMED',
      metadata: { pqcProof, tripleSign },
    });

    return result.hash;
  }

  async receiveAsset(params: ReceiveParams): Promise<string> {
    const { from, expectedAmount, txRef, pqcProof } = params;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'RECEIVE',
      fromAddress: from,
      toAddress: this.keypair.publicKey(),
      amount: expectedAmount,
      status: 'PENDING',
      metadata: { note: 'Receiving verification -- scan for incoming payments', pqcProof },
    });

    return `RECEIVE_${txRef}`;
  }

  // ----------------------------------------------------------
  // HELPERS -- ScVal conversion (simplified)
  // ----------------------------------------------------------

  private _toScValArgs(eventId: string, hash: Buffer, unlockTimestamp: number): any[] {
    return [
      nativeToScVal(eventId, { type: 'string' }),
      nativeToScVal(hash, { type: 'bytes' }),
      nativeToScVal(unlockTimestamp, { type: 'i64' }),
    ];
  }

  private _toScValArgsHashOnly(expectedHash: string): any[] {
    return [nativeToScVal(Buffer.from(expectedHash.replace(/^0x/, ''), 'hex'), { type: 'bytes' })];
  }

  private _toScValEscrowArgs(
    escrowId: string,
    receiver: string,
    amount: string,
    assetAddress: string | undefined,
    unlockTimestamp: number
  ): any[] {
    return [
      nativeToScVal(escrowId, { type: 'string' }),
      nativeToScVal(receiver, { type: 'string' }),
      nativeToScVal(amount, { type: 'i128' }),
      nativeToScVal(assetAddress || null, { type: 'string' }),
      nativeToScVal(unlockTimestamp, { type: 'i64' }),
    ];
  }

  private _toScValEscrowId(escrowId: string): any[] {
    return [nativeToScVal(escrowId, { type: 'string' })];
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
      console.error('[SorobanAdapter] Failed to log transaction to Prisma:', err);
    }
  }
}
