// ============================================================
// WALLET SERVICE
// Business logic for custodial wallet management.
// Handles creation, deposit-address lookup, and balance queries.
//
// SECURITY: Private keys NEVER leave KMSService. This service
// only deals with public addresses and database state.
// ============================================================

import prisma from '../config/prisma';
import { KMSService } from './KMSService';
import { QuantumSignerService } from './QuantumSignerService';

export type SupportedWalletChain = 'ETHEREUM' | 'POLYGON' | 'ALGORAND';

export class WalletService {
  private static instance: WalletService;
  private kms: KMSService;
  private quantumSigner: QuantumSignerService;

  private constructor() {
    this.kms = KMSService.getInstance();
    this.quantumSigner = QuantumSignerService.getInstance();
  }

  static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  /**
   * Creates a custodial UserWallet for a tenant on a given chain.
   * Derives the address from the master key and generates a Falcon-512
   * public key for future Triple-Signature validation.
   */
  async createWallet(tenantId: string, chain: SupportedWalletChain) {
    // Check if wallet already exists
    const existing = await (prisma as any).userWallet.findFirst({
      where: { tenantId, chain },
    });

    if (existing) {
      return existing;
    }

    // Get next account index for this tenant+chain
    const lastWallet = await (prisma as any).userWallet.findFirst({
      where: { tenantId, chain },
      orderBy: { accountIndex: 'desc' },
    });
    const accountIndex = lastWallet ? lastWallet.accountIndex + 1 : 0;

    // Derive address deterministically from master key
    const address = this.kms.deriveAddress(chain, accountIndex);

    // TODO: Generate Falcon-512 keypair for Triple-Sig identity
    // For now, pqcPublicKey is left null until PostQuantumCrypto
    // exposes key generation in the installed version.
    const pqcPublicKey = null;

    const wallet = await (prisma as any).userWallet.create({
      data: {
        tenantId,
        chain,
        address,
        accountIndex,
        pqcPublicKey,
      },
    });

    console.log(
      `[WalletService] Created ${chain} wallet for tenant ${tenantId}: ${address}`
    );

    return wallet;
  }

  /**
   * Returns the deposit address for a tenant on a given chain.
   * Creates the wallet if it doesn't exist.
   */
  async getDepositAddress(tenantId: string, chain: SupportedWalletChain) {
    let wallet = await (prisma as any).userWallet.findFirst({
      where: { tenantId, chain },
    });

    if (!wallet) {
      wallet = await this.createWallet(tenantId, chain);
    }

    return {
      id: wallet.id,
      address: wallet.address,
      chain: wallet.chain,
      pqcPublicKey: wallet.pqcPublicKey,
      createdAt: wallet.createdAt,
    };
  }

  /**
   * Computes the internal balance for a tenant by aggregating
   * all CONFIRMED deposits and subtracting spent amounts.
   *
   * For now, "spent" is tracked via ChainTransaction entries with
   * direction SEND from any of the tenant's wallets.
   */
  async getBalance(tenantId: string, chain?: SupportedWalletChain) {
    const where: any = { tenantId, status: 'CONFIRMED' };
    if (chain) {
      where.chain = chain;
    }

    const deposits = await (prisma as any).deposit.findMany({ where });

    const totalDeposited = deposits.reduce((sum: bigint, d: any) => {
      try {
        return sum + BigInt(d.amount);
      } catch {
        return sum;
      }
    }, BigInt(0));

    // Get all wallets for this tenant (for spent calculation)
    const walletWhere: any = { tenantId };
    if (chain) {
      walletWhere.chain = chain;
    }
    const wallets = await (prisma as any).userWallet.findMany({
      where: walletWhere,
      select: { address: true },
    });
    const walletAddresses = wallets.map((w: any) => w.address);

    // Calculate spent: outgoing transfers from tenant wallets
    const spentTxs = await (prisma as any).chainTransaction.findMany({
      where: {
        tenantId,
        direction: 'SEND',
        status: 'CONFIRMED',
        fromAddress: { in: walletAddresses },
        ...(chain ? { chain } : {}),
      },
    });

    const totalSpent = spentTxs.reduce((sum: bigint, t: any) => {
      try {
        return sum + BigInt(t.amount || '0');
      } catch {
        return sum;
      }
    }, BigInt(0));

    const balance = totalDeposited - totalSpent;

    return {
      tenantId,
      chain: chain || 'ALL',
      totalDeposited: totalDeposited.toString(),
      totalSpent: totalSpent.toString(),
      balance: balance.toString(),
      currency: 'USDC', // Primary stablecoin
      depositCount: deposits.length,
    };
  }
}

