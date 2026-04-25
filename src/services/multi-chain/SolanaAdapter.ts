// ============================================================
// SOLANA ADAPTER -- Solana Program (Anchor Framework)
// Uses @solana/web3.js for all blockchain interactions.
// Supports: Payment (Escrow via PDA), Receiving, Sending, Anchoring
// SECURITY: Durable Nonces are BANNED (Drift Exploit).
//           Uses recentBlockhash with lastValidBlockHeight enforcement.
//
// HYBRID SIGNATURE:
//   - pqcProof embedded in instruction data (after discriminator)
//   - Classical EdDSA via Keypair for transport
// ============================================================

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import prisma from '../../config/prisma';
import { KMSService } from '../KMSService';
import { QuantumSignerService } from '../QuantumSignerService';
import {
  IDLTAdapter,
  AnchorOptions,
  AnchorMode,
  EscrowParams,
  TransferParams,
  ReceiveParams,
} from '../../interfaces/IDLTAdapter';

// Discriminators matching the Anchor program
const DISCRIMINATOR_LOG_A = Buffer.from([0x51, 0x43, 0x5f, 0x4c, 0x4f, 0x47, 0x5f, 0x41]);
const DISCRIMINATOR_PDA_B = Buffer.from([0x51, 0x43, 0x5f, 0x50, 0x44, 0x41, 0x5f, 0x42]);

export class SolanaAdapter implements IDLTAdapter {
  private connection: Connection;
  private authority: Keypair;
  private programId: PublicKey;

  constructor() {
    const kms = KMSService.getInstance();
    const rpcUrl = kms.getKey('SOLANA', 'rpcUrl');
    const privateKeyBase64 = kms.getKey('SOLANA', 'privateKey');
    const programId = process.env.SOLANA_ANCHOR_PROGRAM_ID;

    if (!programId) {
      throw new Error('SOLANA_ANCHOR_PROGRAM_ID is not defined in the environment.');
    }

    this.connection = new Connection(rpcUrl, 'confirmed');
    this.authority = Keypair.fromSecretKey(Buffer.from(privateKeyBase64, 'base64'));
    this.programId = new PublicKey(programId);
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

    const payloadHash = Buffer.from(hash.replace(/^0x/, ''), 'hex');
    if (payloadHash.length !== 64 && payloadHash.length !== 32) {
      throw new Error(`Invalid hash length: ${payloadHash.length}. Expected 32 or 64 bytes.`);
    }
    const hash64 = payloadHash.length === 64 ? payloadHash : Buffer.concat([payloadHash, Buffer.alloc(32)]);

    const mode: AnchorMode = options?.mode ?? 'LOG';
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    if (mode === 'LOG') {
      return this._anchorModeA(hash64, eventId, blockhash, lastValidBlockHeight, options?.pqcProof);
    } else {
      return this._anchorModeB(hash64, eventId, blockhash, lastValidBlockHeight, options);
    }
  }

  async verifyAnchor(txId: string, expectedHash?: string): Promise<boolean> {
    try {
      const tx = await this.connection.getTransaction(txId, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta?.err && tx?.transaction.message) {
        if (expectedHash) {
          const expectedBuf = Buffer.from(expectedHash.replace(/^0x/, ''), 'hex');
          const message = tx.transaction.message;
          for (const ix of message.compiledInstructions) {
            const data = ix.data;
            if (data.length >= 88) {
              const hashInIx = Buffer.from(data.slice(24, 88));
              if (hashInIx.equals(expectedBuf)) {
                return true;
              }
            }
          }
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------
  // ESCROW (via PDA)
  // ----------------------------------------------------------

  async createEscrow(params: EscrowParams): Promise<string> {
    if (params.tripleSign) {
      const validation = await QuantumSignerService.getInstance().verifyTriple(params.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    const { escrowId, sender, receiver, amount, unlockTimestamp, pqcProof, tripleSign } = params;

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('qc_escrow'), Buffer.from(escrowId)],
      this.programId
    );

    const senderPubkey = new PublicKey(sender);
    const receiverPubkey = new PublicKey(receiver);
    const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    const ixData = Buffer.alloc(8 + 4 + escrowId.length + 32 + 8 + 8);
    const initDiscriminator = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    initDiscriminator.copy(ixData, 0);
    ixData.writeUInt32LE(escrowId.length, 8);
    Buffer.from(escrowId).copy(ixData, 12);
    receiverPubkey.toBuffer().copy(ixData, 12 + escrowId.length);
    ixData.writeBigInt64LE(BigInt(unlockTimestamp), 12 + escrowId.length + 32);
    ixData.writeBigUInt64LE(BigInt(lamports), 12 + escrowId.length + 32 + 8);

    const keys = [
      { pubkey: senderPubkey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const instruction = {
      programId: this.programId,
      keys,
      data: ixData,
    };

    const messageV0 = new TransactionMessage({
      payerKey: this.authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([this.authority]);

    const signature = await this.connection.sendTransaction(tx, {
      maxRetries: 3,
      skipPreflight: false,
    });

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: escrowId,
      chain: 'SOLANA',
      direction: 'ESCROW_CREATE',
      fromAddress: sender,
      toAddress: receiver,
      amount,
      chainTxId: signature,
      status: 'CONFIRMED',
      metadata: { unlockTimestamp, escrowPda: escrowPda.toBase58(), pqcProof, tripleSign },
    });

    return signature;
  }

  async releaseEscrow(escrowId: string, txRef: string): Promise<string> {
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('qc_escrow'), Buffer.from(escrowId)],
      this.programId
    );

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    const ixData = Buffer.alloc(8 + 4 + escrowId.length);
    const releaseDiscriminator = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    releaseDiscriminator.copy(ixData, 0);
    ixData.writeUInt32LE(escrowId.length, 8);
    Buffer.from(escrowId).copy(ixData, 12);

    const keys = [
      { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: this.authority.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const instruction = {
      programId: this.programId,
      keys,
      data: ixData,
    };

    const messageV0 = new TransactionMessage({
      payerKey: this.authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([this.authority]);

    const signature = await this.connection.sendTransaction(tx, { maxRetries: 3 });
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'SOLANA',
      direction: 'ESCROW_RELEASE',
      chainTxId: signature,
      status: 'CONFIRMED',
      metadata: { escrowId, escrowPda: escrowPda.toBase58() },
    });

    return signature;
  }

  async cancelEscrow(escrowId: string, txRef: string): Promise<string> {
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('qc_escrow'), Buffer.from(escrowId)],
      this.programId
    );

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    const ixData = Buffer.alloc(8 + 4 + escrowId.length);
    const cancelDiscriminator = Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    cancelDiscriminator.copy(ixData, 0);
    ixData.writeUInt32LE(escrowId.length, 8);
    Buffer.from(escrowId).copy(ixData, 12);

    const keys = [
      { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: this.authority.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const instruction = {
      programId: this.programId,
      keys,
      data: ixData,
    };

    const messageV0 = new TransactionMessage({
      payerKey: this.authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([this.authority]);

    const signature = await this.connection.sendTransaction(tx, { maxRetries: 3 });
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'SOLANA',
      direction: 'ESCROW_CANCEL',
      chainTxId: signature,
      status: 'CONFIRMED',
      metadata: { escrowId, escrowPda: escrowPda.toBase58() },
    });

    return signature;
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
    const toPubkey = new PublicKey(to);
    const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    const instruction = SystemProgram.transfer({
      fromPubkey: this.authority.publicKey,
      toPubkey,
      lamports,
    });

    const messageV0 = new TransactionMessage({
      payerKey: this.authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([this.authority]);

    const signature = await this.connection.sendTransaction(tx, { maxRetries: 3 });
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'SOLANA',
      direction: 'SEND',
      fromAddress: this.authority.publicKey.toBase58(),
      toAddress: to,
      amount,
      chainTxId: signature,
      status: 'CONFIRMED',
      metadata: { pqcProof, tripleSign },
    });

    return signature;
  }

  async receiveAsset(params: ReceiveParams): Promise<string> {
    const { from, expectedAmount, txRef, pqcProof } = params;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'SOLANA',
      direction: 'RECEIVE',
      fromAddress: from,
      toAddress: this.authority.publicKey.toBase58(),
      amount: expectedAmount,
      status: 'PENDING',
      metadata: { note: 'Receiving verification -- scan for incoming transfers', pqcProof },
    });

    return `RECEIVE_${txRef}`;
  }

  // ----------------------------------------------------------
  // MODE A -- LOG (Instruction Data)
  // ----------------------------------------------------------

  private async _anchorModeA(
    payloadHash: Buffer,
    eventId: string,
    blockhash: string,
    lastValidBlockHeight: number,
    pqcProof?: string
  ): Promise<string> {
    const eventIdSlice = Buffer.from(eventId).slice(0, 16);
    const pqcBuffer = pqcProof ? Buffer.from(pqcProof) : Buffer.alloc(0);
    const ixData = Buffer.concat([DISCRIMINATOR_LOG_A, eventIdSlice, payloadHash, pqcBuffer]);

    const instruction = {
      programId: this.programId,
      keys: [
        { pubkey: this.authority.publicKey, isSigner: true, isWritable: false },
      ],
      data: ixData,
    };

    const messageV0 = new TransactionMessage({
      payerKey: this.authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([this.authority]);

    const signature = await this.connection.sendTransaction(tx, {
      maxRetries: 3,
      skipPreflight: false,
    });

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    return signature;
  }

  // ----------------------------------------------------------
  // MODE B -- STATE (PDA)
  // ----------------------------------------------------------

  private async _anchorModeB(
    payloadHash: Buffer,
    eventId: string,
    blockhash: string,
    lastValidBlockHeight: number,
    options?: AnchorOptions
  ): Promise<string> {
    const [anchorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('qc_anchor'), Buffer.from(eventId)],
      this.programId
    );

    const unlockTimestamp = BigInt(options?.unlockTimestamp ?? 0);
    const pqcBuffer = options?.pqcProof ? Buffer.from(options.pqcProof) : Buffer.alloc(0);
    const pdaData = Buffer.concat([
      this.authority.publicKey.toBuffer(),
      payloadHash,
      Buffer.from([unlockTimestamp > 0n ? 0x02 : 0x01]),
      pqcBuffer,
    ]);

    const ixData = Buffer.concat([DISCRIMINATOR_PDA_B, Buffer.alloc(8), pdaData]);

    const instruction = {
      programId: this.programId,
      keys: [
        { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: anchorPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: ixData,
    };

    const messageV0 = new TransactionMessage({
      payerKey: this.authority.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([this.authority]);

    const signature = await this.connection.sendTransaction(tx, {
      maxRetries: 3,
      skipPreflight: false,
    });

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    return signature;
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
    chainTxId?: string;
    status: string;
    metadata?: Record<string, unknown>;
    error?: string;
  }) {
    try {
      await prisma.chainTransaction.create({ data });
    } catch (err) {
      console.error('[SolanaAdapter] Failed to log transaction to Prisma:', err);
    }
  }
}

