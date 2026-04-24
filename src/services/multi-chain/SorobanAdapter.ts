// ==========================================================
// SOROBAN ADAPTER — Stellar Soroban Smart Contract Integration
// Uses @stellar/stellar-sdk for all blockchain interactions.
// Supports: Payment (Escrow), Receiving, Sending, Anchoring
// SECURITY: Classic Memo is BANNED (28b limit < 64b SHA3-512).
//           Always uses Soroban contract invocation.
// ==========================================================

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
} from '@stellar/stellar-sdk';
import prisma from '../../config/prisma';
import {
  IDLTAdapter,
  AnchorOptions,
  EscrowParams,
  TransferParams,
  ReceiveParams,
} from '../../interfaces/IDLTAdapter';

export class SorobanAdapter implements IDLTAdapter {
  private horizonServer: Horizon.Server;
  private sorobanServer: InstanceType<typeof SorobanRpc.Server>;
  private keypair: Keypair;
  private contractId: string;
  private networkPassphrase: string;

  constructor() {
    const horizonUrl = process.env.STELLAR_HORIZON_URL;
    const sorobanRpcUrl = process.env.STELLAR_SOROBAN_RPC_URL;
    const secretKey = process.env.STELLAR_AUTHORITY_SECRET_KEY;
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
    const payloadHash = Buffer.from(hash.replace(/^0x/, ''), 'hex');
    if (payloadHash.length !== 64 && payloadHash.length !== 32) {
      throw new Error(`Invalid hash length: ${payloadHash.length}. Expected 32 or 64 bytes.`);
    }
    const hash64 = payloadHash.length === 64 ? payloadHash : Buffer.concat([payloadHash, Buffer.alloc(32)]);

    const unlockTimestamp = options?.unlockTimestamp ?? 0;

    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const txBuilder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(
        contract.call(
          'anchor_event',
          ...this._toScValArgs(eventId, hash64, unlockTimestamp)
        )
      );

    const tx = txBuilder.build();
    const simResult = await this.sorobanServer.simulateTransaction(tx);

    if (!simResult || simResult.error) {
      throw new Error(`Soroban simulation failed: ${simResult?.error || 'unknown'}`);
    }

    const assembled = TransactionBuilder.fromXDR(
      simResult.transactionData?.build().toXDR('base64') || tx.toXDR(),
      this.networkPassphrase
    );

    assembled.sign(this.keypair);
    const sendResult = await this.sorobanServer.sendTransaction(assembled);

    if (sendResult.status !== 'PENDING') {
      throw new Error(`Soroban send failed: ${sendResult.status}`);
    }

    const txHash = sendResult.hash;
    let result = await this.sorobanServer.getTransaction(txHash);
    const startTime = Date.now();
    const timeout = 30000;

    while (result.status === 'NOT_FOUND' && Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await this.sorobanServer.getTransaction(txHash);
    }

    if (result.status !== 'SUCCESS') {
      throw new Error(`Soroban transaction failed: ${result.status}`);
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: eventId,
      chain: 'STELLAR',
      direction: 'ANCHOR',
      chainTxId: txHash,
      status: 'CONFIRMED',
      metadata: { eventId, hash: hash64.toString('hex'), unlockTimestamp },
    });

    return txHash;
  }

  async verifyAnchor(txId: string, expectedHash?: string): Promise<boolean> {
    try {
      const result = await this.sorobanServer.getTransaction(txId);
      if (result.status !== 'SUCCESS') return false;

      if (expectedHash) {
        const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
        const contract = new Contract(this.contractId);

        const txBuilder = new TransactionBuilder(account, {
          fee: '100000',
          networkPassphrase: this.networkPassphrase,
        })
          .setTimeout(30)
          .addOperation(contract.call('get_anchor_hash', ...this._toScValArgsHashOnly(expectedHash)));

        const tx = txBuilder.build();
        const simResult = await this.sorobanServer.simulateTransaction(tx);

        if (simResult && !simResult.error) {
          return true;
        }
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------
  // ESCROW
  // ----------------------------------------------------------

  async createEscrow(params: EscrowParams): Promise<string> {
    const { escrowId, sender, receiver, amount, assetAddress, unlockTimestamp } = params;

    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const txBuilder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(
        contract.call(
          'create_escrow',
          ...this._toScValEscrowArgs(escrowId, receiver, amount, assetAddress, unlockTimestamp)
        )
      );

    const tx = txBuilder.build();
    const simResult = await this.sorobanServer.simulateTransaction(tx);

    if (!simResult || simResult.error) {
      throw new Error(`Soroban simulation failed: ${simResult?.error || 'unknown'}`);
    }

    const assembled = TransactionBuilder.fromXDR(
      simResult.transactionData?.build().toXDR('base64') || tx.toXDR(),
      this.networkPassphrase
    );
    assembled.sign(this.keypair);

    const sendResult = await this.sorobanServer.sendTransaction(assembled);
    if (sendResult.status !== 'PENDING') {
      throw new Error(`Soroban send failed: ${sendResult.status}`);
    }

    const txHash = sendResult.hash;
    let result = await this.sorobanServer.getTransaction(txHash);
    const startTime = Date.now();
    const timeout = 30000;

    while (result.status === 'NOT_FOUND' && Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await this.sorobanServer.getTransaction(txHash);
    }

    if (result.status !== 'SUCCESS') {
      throw new Error(`Soroban transaction failed: ${result.status}`);
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: escrowId,
      chain: 'STELLAR',
      direction: 'ESCROW_CREATE',
      fromAddress: sender,
      toAddress: receiver,
      amount,
      assetAddress: assetAddress || null,
      chainTxId: txHash,
      status: 'CONFIRMED',
      metadata: { unlockTimestamp },
    });

    return txHash;
  }

  async releaseEscrow(escrowId: string, txRef: string): Promise<string> {
    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const txBuilder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('release_escrow', ...this._toScValEscrowId(escrowId)));

    const tx = txBuilder.build();
    const simResult = await this.sorobanServer.simulateTransaction(tx);

    if (!simResult || simResult.error) {
      throw new Error(`Soroban simulation failed: ${simResult?.error || 'unknown'}`);
    }

    const assembled = TransactionBuilder.fromXDR(
      simResult.transactionData?.build().toXDR('base64') || tx.toXDR(),
      this.networkPassphrase
    );
    assembled.sign(this.keypair);

    const sendResult = await this.sorobanServer.sendTransaction(assembled);
    if (sendResult.status !== 'PENDING') {
      throw new Error(`Soroban send failed: ${sendResult.status}`);
    }

    const txHash = sendResult.hash;
    let result = await this.sorobanServer.getTransaction(txHash);
    const startTime = Date.now();
    const timeout = 30000;

    while (result.status === 'NOT_FOUND' && Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await this.sorobanServer.getTransaction(txHash);
    }

    if (result.status !== 'SUCCESS') {
      throw new Error(`Soroban transaction failed: ${result.status}`);
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'ESCROW_RELEASE',
      chainTxId: txHash,
      status: 'CONFIRMED',
      metadata: { escrowId },
    });

    return txHash;
  }

  async cancelEscrow(escrowId: string, txRef: string): Promise<string> {
    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.contractId);

    const txBuilder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(contract.call('cancel_escrow', ...this._toScValEscrowId(escrowId)));

    const tx = txBuilder.build();
    const simResult = await this.sorobanServer.simulateTransaction(tx);

    if (!simResult || simResult.error) {
      throw new Error(`Soroban simulation failed: ${simResult?.error || 'unknown'}`);
    }

    const assembled = TransactionBuilder.fromXDR(
      simResult.transactionData?.build().toXDR('base64') || tx.toXDR(),
      this.networkPassphrase
    );
    assembled.sign(this.keypair);

    const sendResult = await this.sorobanServer.sendTransaction(assembled);
    if (sendResult.status !== 'PENDING') {
      throw new Error(`Soroban send failed: ${sendResult.status}`);
    }

    const txHash = sendResult.hash;
    let result = await this.sorobanServer.getTransaction(txHash);
    const startTime = Date.now();
    const timeout = 30000;

    while (result.status === 'NOT_FOUND' && Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await this.sorobanServer.getTransaction(txHash);
    }

    if (result.status !== 'SUCCESS') {
      throw new Error(`Soroban transaction failed: ${result.status}`);
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'ESCROW_CANCEL',
      chainTxId: txHash,
      status: 'CONFIRMED',
      metadata: { escrowId },
    });

    return txHash;
  }

  // ----------------------------------------------------------
  // SEND / RECEIVE
  // ----------------------------------------------------------

  async sendAsset(params: TransferParams): Promise<string> {
    const { to, amount, txRef } = params;

    const account = await this.horizonServer.loadAccount(this.keypair.publicKey());

    const txBuilder = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(
        Operation.payment({
          destination: to,
          asset: Asset.native(),
          amount: amount,
        })
      );

    const tx = txBuilder.build();
    tx.sign(this.keypair);

    const result = await this.horizonServer.submitTransaction(tx);
    const txHash = result.hash;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'SEND',
      fromAddress: this.keypair.publicKey(),
      toAddress: to,
      amount,
      chainTxId: txHash,
      status: 'CONFIRMED',
    });

    return txHash;
  }

  async receiveAsset(params: ReceiveParams): Promise<string> {
    const { from, expectedAmount, txRef } = params;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'STELLAR',
      direction: 'RECEIVE',
      fromAddress: from,
      toAddress: this.keypair.publicKey(),
      amount: expectedAmount,
      status: 'PENDING',
      metadata: { note: 'Receiving verification — scan for incoming payments' },
    });

    return `RECEIVE_${txRef}`;
  }

  // ----------------------------------------------------------
  // HELPERS — ScVal conversion
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

