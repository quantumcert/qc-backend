// ============================================================
// POLYGON ADAPTER -- Polygon PoS Chain Integration
// EVM-compatible adapter extending EthAdapter pattern.
// Uses ethers.js v6 with Polygon chainId (137).
// Supports: Commission, Registry, Anchoring, Escrow, Transfers
//
// HYBRID SIGNATURE:
//   - pqcProof embedded in transaction metadata
//   - Classical ECDSA via ethers.Wallet for transport
// ============================================================

import { ethers } from 'ethers';
import prisma from '../../config/prisma';
import { KMSService } from '../KMSService';
import { QuantumSignerService } from '../QuantumSignerService';
import {
  IDLTAdapter,
  AnchorOptions,
  EscrowParams,
  TransferParams,
  ReceiveParams,
} from '../../interfaces/IDLTAdapter';

const POLYGON_CHAIN_ID = 137;

// Minimal ABI for the TransferFacet on Polygon
const TRANSFER_FACET_ABI = [
  'function createEscrow(bytes32 escrowId, address receiver, uint256 unlockTimestamp, address assetAddress, uint256 amount) external payable returns (bool)',
  'function releaseEscrow(bytes32 escrowId) external returns (bool)',
  'function cancelEscrow(bytes32 escrowId) external returns (bool)',
  'function directTransfer(address to, uint256 amount, address assetAddress, bytes32 txRef) external payable returns (bool)',
  'function anchorEvent(bytes32 eventId, bytes32 payloadHash) external returns (bool)',
  'function getEscrow(bytes32 escrowId) external view returns (tuple(address sender, address receiver, uint256 amount, address assetAddress, uint256 unlockTimestamp, uint256 createdAt, bool released, bool cancelled))',
  'function isAnchored(bytes32 eventId) external view returns (bool)',
  'event EscrowCreated(bytes32 indexed escrowId, address indexed sender, address indexed receiver, uint256 amount, address assetAddress, uint256 unlockTimestamp, uint256 createdAt)',
  'event EscrowReleased(bytes32 indexed escrowId, address indexed receiver, uint256 amount, uint256 releasedAt)',
  'event EscrowCancelled(bytes32 indexed escrowId, address indexed sender, uint256 amount, uint256 cancelledAt)',
  'event DirectTransfer(address indexed from, address indexed to, uint256 amount, address assetAddress, bytes32 indexed txRef)',
  'event AnchorEvent(bytes32 indexed eventIdHash, bytes32 indexed payloadHash, uint256 anchoredAt)',
];

export class PolygonAdapter implements IDLTAdapter {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private facetContract: ethers.Contract | null;

  constructor() {
    const kms = KMSService.getInstance();
    const rpcUrl = kms.getKey('POLYGON', 'rpcUrl');
    const privateKey = kms.getKey('POLYGON', 'privateKey');
    const facetAddress = process.env.POLYGON_TRANSFER_FACET_ADDRESS;

    this.provider = new ethers.JsonRpcProvider(rpcUrl, POLYGON_CHAIN_ID);
    this.wallet = new ethers.Wallet(privateKey, this.provider);

    if (facetAddress) {
      this.facetContract = new ethers.Contract(facetAddress, TRANSFER_FACET_ABI, this.wallet);
    } else {
      console.warn('[PolygonAdapter] POLYGON_TRANSFER_FACET_ADDRESS not set. Facet operations will fail.');
      this.facetContract = null;
    }
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

    if (!this.facetContract) {
      throw new Error('Polygon TransferFacet not configured.');
    }

    const eventIdHash = ethers.keccak256(ethers.toUtf8Bytes(eventId));
    const payloadHash = ethers.zeroPadValue(hash.startsWith('0x') ? hash : '0x' + hash, 32);

    const tx = await this.facetContract.anchorEvent(eventIdHash, payloadHash);
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error('Anchor transaction receipt not found');
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: eventId,
      chain: 'POLYGON',
      direction: 'ANCHOR',
      chainTxId: tx.hash,
      status: receipt.status === 1 ? 'CONFIRMED' : 'FAILED',
      metadata: { eventId, hash, blockNumber: receipt.blockNumber, pqcProof: options?.pqcProof },
    });

    return tx.hash;
  }

  async verifyAnchor(txId: string, expectedHash?: string): Promise<boolean> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txId);
      if (!receipt || receipt.status !== 1) return false;

      if (expectedHash && this.facetContract) {
        const iface = new ethers.Interface(TRANSFER_FACET_ABI);
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === 'AnchorEvent') {
              const onChainHash = parsed.args.payloadHash as string;
              const normalized = expectedHash.startsWith('0x')
                ? expectedHash.toLowerCase()
                : '0x' + expectedHash.toLowerCase();
              if (onChainHash.toLowerCase() === normalized) return true;
            }
          } catch {
            // skip non-matching logs
          }
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
    if (params.tripleSign) {
      const validation = await QuantumSignerService.getInstance().verifyTriple(params.tripleSign);
      if (!validation.valid) {
        throw new Error(`Triple-signature validation failed: ${validation.reason}`);
      }
    }

    if (!this.facetContract) {
      throw new Error('Polygon TransferFacet not configured.');
    }

    const { escrowId, sender, receiver, amount, assetAddress, unlockTimestamp, pqcProof, tripleSign } = params;
    const escrowIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(escrowId));
    const receiverAddr = ethers.getAddress(receiver);
    const unlockTs = BigInt(unlockTimestamp);
    const assetAddr = assetAddress ? ethers.getAddress(assetAddress) : ethers.ZeroAddress;
    const amountBig = BigInt(amount);

    if (ethers.getAddress(sender) !== this.wallet.address) {
      throw new Error(`Sender ${sender} does not match adapter wallet ${this.wallet.address}`);
    }

    let tx: ethers.ContractTransactionResponse;

    if (assetAddress) {
      const tokenContract = new ethers.Contract(
        assetAddr,
        ['function approve(address spender, uint256 amount) external returns (bool)'],
        this.wallet
      );
      const approveTx = await tokenContract.approve(await this.facetContract.getAddress(), amountBig);
      await approveTx.wait();

      tx = await this.facetContract.createEscrow(
        escrowIdBytes32, receiverAddr, unlockTs, assetAddr, amountBig
      );
    } else {
      tx = await this.facetContract.createEscrow(
        escrowIdBytes32, receiverAddr, unlockTs, ethers.ZeroAddress, amountBig, { value: amountBig }
      );
    }

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error('Escrow creation transaction failed');
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef: escrowId,
      chain: 'POLYGON',
      direction: 'ESCROW_CREATE',
      fromAddress: sender,
      toAddress: receiver,
      amount,
      assetAddress: assetAddress || null,
      chainTxId: tx.hash,
      status: 'CONFIRMED',
      metadata: { unlockTimestamp, blockNumber: receipt.blockNumber, pqcProof, tripleSign },
    });

    return tx.hash;
  }

  async releaseEscrow(escrowId: string, txRef: string): Promise<string> {
    if (!this.facetContract) {
      throw new Error('Polygon TransferFacet not configured.');
    }

    const escrowIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(escrowId));
    const tx = await this.facetContract.releaseEscrow(escrowIdBytes32);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Escrow release transaction failed');
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'POLYGON',
      direction: 'ESCROW_RELEASE',
      chainTxId: tx.hash,
      status: 'CONFIRMED',
      metadata: { escrowId, blockNumber: receipt.blockNumber },
    });

    return tx.hash;
  }

  async cancelEscrow(escrowId: string, txRef: string): Promise<string> {
    if (!this.facetContract) {
      throw new Error('Polygon TransferFacet not configured.');
    }

    const escrowIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(escrowId));
    const tx = await this.facetContract.cancelEscrow(escrowIdBytes32);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Escrow cancellation transaction failed');
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'POLYGON',
      direction: 'ESCROW_CANCEL',
      chainTxId: tx.hash,
      status: 'CONFIRMED',
      metadata: { escrowId, blockNumber: receipt.blockNumber },
    });

    return tx.hash;
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

    if (!this.facetContract) {
      throw new Error('Polygon TransferFacet not configured.');
    }

    const { to, amount, assetAddress, txRef, pqcProof, tripleSign } = params;
    const toAddr = ethers.getAddress(to);
    const amountBig = BigInt(amount);
    const assetAddr = assetAddress ? ethers.getAddress(assetAddress) : ethers.ZeroAddress;
    const txRefBytes32 = ethers.keccak256(ethers.toUtf8Bytes(txRef));

    let tx: ethers.ContractTransactionResponse;

    if (assetAddress) {
      const tokenContract = new ethers.Contract(
        assetAddr,
        ['function approve(address spender, uint256 amount) external returns (bool)'],
        this.wallet
      );
      const approveTx = await tokenContract.approve(await this.facetContract.getAddress(), amountBig);
      await approveTx.wait();

      tx = await this.facetContract.directTransfer(toAddr, amountBig, assetAddr, txRefBytes32);
    } else {
      tx = await this.facetContract.directTransfer(toAddr, amountBig, ethers.ZeroAddress, txRefBytes32, {
        value: amountBig,
      });
    }

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error('Direct transfer transaction failed');
    }

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'POLYGON',
      direction: 'SEND',
      fromAddress: this.wallet.address,
      toAddress: to,
      amount,
      assetAddress: assetAddress || null,
      chainTxId: tx.hash,
      status: 'CONFIRMED',
      metadata: { blockNumber: receipt.blockNumber, pqcProof, tripleSign },
    });

    return tx.hash;
  }

  async receiveAsset(params: ReceiveParams): Promise<string> {
    const { from, expectedAmount, assetAddress, txRef, pqcProof } = params;

    await this.logTransaction({
      tenantId: 'SYSTEM',
      txRef,
      chain: 'POLYGON',
      direction: 'RECEIVE',
      fromAddress: from,
      toAddress: this.wallet.address,
      amount: expectedAmount,
      assetAddress: assetAddress || null,
      status: 'PENDING',
      metadata: { note: 'Receiving verification pending on-chain confirmation', pqcProof },
    });

    return `RECEIVE_${txRef}`;
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
      await prisma.chainTransaction.create({ data });
    } catch (err) {
      console.error('[PolygonAdapter] Failed to log transaction to Prisma:', err);
    }
  }
}

