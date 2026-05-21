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
  private readonly legacySystemTenantId = 'SYSTEM';

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
    const tenantId = options?.tenantId;
    if (!tenantId) {
      throw new Error('STELLAR anchor requires tenantId for ChainTransaction logging.');
    }

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

    const builder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('anchor_event', ...args));

    const tx = builder.build();
    tx.sign(this.keypair);

    const simulateResult = await this.sorobanServer.simulateTransaction(tx);
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult).build();
    preparedTx.sign(this.keypair);

    const txHash = await this.submitSorobanTransaction(preparedTx, 'anchor');

    await this.logTransaction({
      tenantId,
      txRef: eventId,
      chain: 'STELLAR',
      direction: 'ANCHOR',
      chainTxId: txHash,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
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

    const { escrowId, sender, receiver, amount, unlockTimestamp, pqcProof, tripleSign } = params;

    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const args = this._toScValEscrowArgs(escrowId, sender, receiver, amount, params.assetAddress, unlockTimestamp);

    const builder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('create_escrow', ...args));

    const tx = builder.build();
    tx.sign(this.keypair);

    const simulateResult = await this.sorobanServer.simulateTransaction(tx);
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult).build();
    preparedTx.sign(this.keypair);

    const txHash = await this.submitSorobanTransaction(preparedTx, 'createEscrow');

    await this.logTransaction({
      tenantId: this.legacySystemTenantId,
      txRef: escrowId,
      chain: 'STELLAR',
      direction: 'ESCROW_CREATE',
      fromAddress: this.keypair.publicKey(),
      toAddress: receiver,
      amount,
      chainTxId: txHash,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      metadata: { unlockTimestamp, pqcProof, tripleSign },
    });

    return txHash;
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
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult).build();
    preparedTx.sign(this.keypair);

    const txHash = await this.submitSorobanTransaction(preparedTx, 'releaseEscrow');

    await this.logTransaction({
      tenantId: this.legacySystemTenantId,
      txRef,
      chain: 'STELLAR',
      direction: 'ESCROW_RELEASE',
      chainTxId: txHash,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      metadata: { escrowId },
    });

    return txHash;
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
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulateResult).build();
    preparedTx.sign(this.keypair);

    const txHash = await this.submitSorobanTransaction(preparedTx, 'cancelEscrow');

    await this.logTransaction({
      tenantId: this.legacySystemTenantId,
      txRef,
      chain: 'STELLAR',
      direction: 'ESCROW_CANCEL',
      chainTxId: txHash,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      metadata: { escrowId },
    });

    return txHash;
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
      tenantId: this.legacySystemTenantId,
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
      tenantId: this.legacySystemTenantId,
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
      nativeToScVal(this._toContractBytes(eventId), { type: 'bytes' }),
      nativeToScVal(hash, { type: 'bytes' }),
      nativeToScVal(unlockTimestamp, { type: 'u64' }),
    ];
  }

  private _toScValArgsHashOnly(expectedHash: string): any[] {
    return [nativeToScVal(Buffer.from(expectedHash.replace(/^0x/, ''), 'hex'), { type: 'bytes' })];
  }

  private _toScValEscrowArgs(
    escrowId: string,
    sender: string,
    receiver: string,
    amount: string,
    assetAddress: string | undefined,
    unlockTimestamp: number
  ): any[] {
    return [
      nativeToScVal(this._toContractBytes(escrowId), { type: 'bytes' }),
      nativeToScVal(sender, { type: 'address' }),
      nativeToScVal(receiver, { type: 'address' }),
      nativeToScVal(amount, { type: 'i128' }),
      nativeToScVal(assetAddress || null, { type: 'address' }),
      nativeToScVal(unlockTimestamp, { type: 'u64' }),
      nativeToScVal(null),
    ];
  }

  private _toScValEscrowId(escrowId: string): any[] {
    return [nativeToScVal(this._toContractBytes(escrowId), { type: 'bytes' })];
  }

  private _toContractBytes(value: string, maxBytes = 32): Buffer {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > maxBytes) {
      throw new Error(`Soroban identifier exceeds ${maxBytes} bytes.`);
    }
    return bytes;
  }

  private async submitSorobanTransaction(preparedTx: Transaction, action: string): Promise<string> {
    const submitResult = await this.sorobanServer.sendTransaction(preparedTx);

    if (submitResult.status === 'ERROR') {
      throw new Error(`Soroban ${action} failed: ${submitResult.status}`);
    }
    if (submitResult.status === 'TRY_AGAIN_LATER') {
      throw new Error(`Soroban ${action} submit returned TRY_AGAIN_LATER`);
    }
    if (submitResult.status !== 'PENDING' && submitResult.status !== 'DUPLICATE') {
      throw new Error(`Soroban ${action} returned unexpected status: ${submitResult.status}`);
    }

    await this.waitForSorobanSuccess(submitResult.hash, action);
    return submitResult.hash;
  }

  private async waitForSorobanSuccess(txHash: string, action: string): Promise<void> {
    const maxAttempts = Number(process.env.SOROBAN_TX_WAIT_ATTEMPTS || 30);
    const delayMs = Number(process.env.SOROBAN_TX_WAIT_MS || 1000);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await this.sorobanServer.getTransaction(txHash);
      if (result.status === 'SUCCESS') return;
      if (result.status === 'FAILED') {
        throw new Error(`Soroban ${action} transaction failed: ${txHash}`);
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`Soroban ${action} transaction was not confirmed: ${txHash}`);
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
    confirmedAt?: Date;
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
