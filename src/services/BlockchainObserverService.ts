// ============================================================
// BLOCKCHAIN OBSERVER SERVICE
// Singleton. Custodial Deposit Flow -- detects incoming
// stablecoin deposits to UserWallet addresses.
//
// SECURITY: This service is READ-ONLY. It never accesses
// private keys. All key material stays in KMSService.
//
// SUPPORTED CHAINS:
//   - EVM (Polygon, Ethereum): ERC-20 Transfer event polling
//   - Algorand: ASA transfer monitoring via algod/indexer
//
// IDEMPOTENCY: txHash is UNIQUE in the Deposit table.
// ============================================================

import { ethers } from 'ethers';
import algosdk from 'algosdk';
import prisma from '../config/prisma';
import { KMSService } from './KMSService';

// ERC-20 Transfer event topic0
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Minimal ERC-20 ABI for event parsing
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

export type SupportedObserverChain = 'ETHEREUM' | 'POLYGON' | 'ALGORAND';

interface ChainObserverConfig {
  chain: SupportedObserverChain;
  rpcUrl: string;
  confirmationThreshold: number;
  stablecoinContracts: Array<{
    address: string;
    symbol: string;
  }>;
}

interface EVMTransferEvent {
  from: string;
  to: string;
  value: bigint;
  txHash: string;
  blockNumber: number;
  contractAddress: string;
  symbol: string;
}

export class BlockchainObserverService {
  private static instance: BlockchainObserverService;
  private kms: KMSService;
  private isRunning: boolean = false;
  private lastScannedBlock: Map<string, number> = new Map();
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();

  private constructor() {
    this.kms = KMSService.getInstance();
  }

  static getInstance(): BlockchainObserverService {
    if (!BlockchainObserverService.instance) {
      BlockchainObserverService.instance = new BlockchainObserverService();
    }
    return BlockchainObserverService.instance;
  }

  /**
   * Returns the required confirmation threshold for a given chain.
   * Used by tests and controllers.
   */
  static getRequiredConfirmations(chain: SupportedObserverChain): number {
    const map: Record<string, number> = {
      POLYGON: 12,
      ETHEREUM: 12,
      ALGORAND: 0,
    };
    return map[chain] ?? 12;

  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  /**
   * Main entry point called by SchedulerService cron job.
   * Scans all configured chains for new deposits.
   */
  async scanAllChains(): Promise<{
    totalNewDeposits: number;
    totalConfirmed: number;
    errors: string[];
  }> {
    if (this.isRunning) {
      console.log('[BlockchainObserver] Scan already in progress, skipping.');
      return { totalNewDeposits: 0, totalConfirmed: 0, errors: [] };
    }

    this.isRunning = true;
    const errors: string[] = [];
    let totalNewDeposits = 0;
    let totalConfirmed = 0;

    try {
      const configs = this.loadChainConfigs();

      for (const config of configs) {
        try {
          const result = await this.scanChain(config);
          totalNewDeposits += result.newDeposits;
          totalConfirmed += result.newlyConfirmed;
        } catch (err: any) {
          const msg = `[BlockchainObserver] ${config.chain} scan failed: ${err.message}`;
          console.error(msg);
          errors.push(msg);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return { totalNewDeposits, totalConfirmed, errors };
  }

  /**
   * Check confirmations for existing PENDING deposits.
   * Called by SchedulerService alongside scanAllChains.
   */
  async checkConfirmations(): Promise<number> {
    let confirmedCount = 0;

    const pendingDeposits = await prisma.deposit.findMany({
      where: { status: 'PENDING' },
      include: { wallet: true },
    });

    for (const deposit of pendingDeposits) {
      try {
        const isConfirmed = await this.verifyConfirmations(
          deposit.chain as SupportedObserverChain,
          deposit.txHash,
          deposit.requiredConfirmations
        );

        if (isConfirmed) {
          await prisma.deposit.update({
            where: { id: deposit.id },
            data: {
              status: 'CONFIRMED',
              confirmedAt: new Date(),
            },
          });
          confirmedCount++;
          console.log(
            `[BlockchainObserver] Deposit ${deposit.txHash} confirmed on ${deposit.chain}`
          );
        }
      } catch (err: any) {
        console.error(
          `[BlockchainObserver] Failed to check confirmations for ${deposit.txHash}:`,
          err.message
        );
      }
    }

    return confirmedCount;
  }

  // ----------------------------------------------------------
  // CHAIN-SPECIFIC SCANNING
  // ----------------------------------------------------------

  private async scanChain(config: ChainObserverConfig): Promise<{
    newDeposits: number;
    newlyConfirmed: number;
  }> {
    switch (config.chain) {
      case 'ETHEREUM':
      case 'POLYGON':
        return this.scanEVMChain(config);
      case 'ALGORAND':
        return this.scanAlgorandChain(config);
      default:
        throw new Error(`Unsupported observer chain: ${config.chain}`);
    }
  }

  // ─── EVM SCANNING (Polygon / Ethereum) ───────────────────

  private async scanEVMChain(
    config: ChainObserverConfig
  ): Promise<{ newDeposits: number; newlyConfirmed: number }> {
    const provider = this.getEVMProvider(config.chain, config.rpcUrl);
    const currentBlock = await provider.getBlockNumber();
    const lastScanned = this.lastScannedBlock.get(config.chain) || currentBlock - 100;
    const fromBlock = Math.max(lastScanned + 1, currentBlock - 500); // max 500 blocks back

    // Fetch all monitored addresses for this chain
    const wallets = await prisma.userWallet.findMany({
      where: { chain: config.chain },
    });

    if (wallets.length === 0) {
      this.lastScannedBlock.set(config.chain, currentBlock);
      return { newDeposits: 0, newlyConfirmed: 0 };
    }

    const monitoredAddresses = wallets.map((w: { address: string }) => w.address.toLowerCase());
    const addressToWallet = new Map<string, typeof wallets[0]>(
      wallets.map((w: typeof wallets[0]) => [w.address.toLowerCase(), w])
    );

    let newDeposits = 0;

    for (const stablecoin of config.stablecoinContracts) {
      const contract = new ethers.Contract(stablecoin.address, ERC20_ABI, provider);

      const filter = contract.filters.Transfer(null, monitoredAddresses);
      const events = await contract.queryFilter(filter, fromBlock, currentBlock);

      for (const event of events) {
        const transfer = this.parseEVMTransfer(event, stablecoin.address, stablecoin.symbol);
        if (!transfer) continue;

        const wallet = addressToWallet.get(transfer.to.toLowerCase());
        if (!wallet) continue;

        const isNew = await this.upsertDeposit({
          tenantId: wallet.tenantId,
          walletId: wallet.id,
          txHash: transfer.txHash,
          amount: transfer.value.toString(),
          currency: transfer.symbol,
          assetAddress: transfer.contractAddress,
          chain: config.chain,
          blockNumber: transfer.blockNumber.toString(),
          requiredConfirmations: config.confirmationThreshold,
          metadata: { from: transfer.from },
        });

        if (isNew) newDeposits++;
      }
    }

    this.lastScannedBlock.set(config.chain, currentBlock);

    // Check confirmations for pending deposits on this chain
    const newlyConfirmed = await this.checkConfirmationsForChain(config.chain);

    return { newDeposits, newlyConfirmed };
  }

  private parseEVMTransfer(
    event: ethers.EventLog | ethers.Log,
    contractAddress: string,
    symbol: string
  ): EVMTransferEvent | null {
    try {
      const iface = new ethers.Interface(ERC20_ABI);
      const parsed = iface.parseLog({
        topics: event.topics as string[],
        data: event.data,
      });

      if (!parsed || parsed.name !== 'Transfer') return null;

      return {
        from: parsed.args.from as string,
        to: parsed.args.to as string,
        value: parsed.args.value as bigint,
        txHash: event.transactionHash,
        blockNumber: Number(event.blockNumber),
        contractAddress,
        symbol,
      };
    } catch {
      return null;
    }
  }

  // ─── ALGORAND SCANNING ───────────────────────────────────

  private async scanAlgorandChain(
    config: ChainObserverConfig
  ): Promise<{ newDeposits: number; newlyConfirmed: number }> {
    const wallets = await prisma.userWallet.findMany({
      where: { chain: 'ALGORAND' },
    });

    if (wallets.length === 0) {
      return { newDeposits: 0, newlyConfirmed: 0 };
    }

    const token = this.kms.getKey('ALGORAND', 'apiToken');
    const server = this.kms.getKey('ALGORAND', 'rpcUrl');
    const port = process.env.ALGOD_PORT || '';
    const algodClient = new algosdk.Algodv2(token, server, port);

    let newDeposits = 0;

    for (const wallet of wallets) {
      try {
        const accountInfo = await algodClient.accountInformation(wallet.address).do();
        const assets = accountInfo.assets || [];

        for (const asset of assets) {
          const assetId = (asset as any).assetId?.toString();
          const amount = asset.amount?.toString();

          if (!assetId || !amount || amount === '0') continue;

          // Check if this ASA is one of our tracked stablecoins
          const stablecoin = config.stablecoinContracts.find(
            (s) => s.address === assetId
          );
          if (!stablecoin) continue;

          // Algorand doesn't have txHash in accountInfo; we'd need indexer
          // For now, log a warning that full Algorand support requires indexer
          console.warn(
            `[BlockchainObserver] Algorand deposit detected for ${wallet.address} ` +
            `ASA ${assetId} amount ${amount}. Full tx tracking requires Algorand Indexer integration.`
          );
        }
      } catch (err: any) {
        console.error(
          `[BlockchainObserver] Algorand scan failed for ${wallet.address}:`,
          err.message
        );
      }
    }

    const newlyConfirmed = await this.checkConfirmationsForChain('ALGORAND');
    return { newDeposits, newlyConfirmed };
  }

  // ----------------------------------------------------------
  // CONFIRMATION LOGIC
  // ----------------------------------------------------------

  private async verifyConfirmations(
    chain: SupportedObserverChain,
    txHash: string,
    requiredConfirmations: number
  ): Promise<boolean> {
    switch (chain) {
      case 'ETHEREUM':
      case 'POLYGON': {
        const provider = this.getEVMProvider(chain);
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt || !receipt.blockNumber) return false;
        const currentBlock = await provider.getBlockNumber();
        const confirmations = currentBlock - receipt.blockNumber;
        return confirmations >= requiredConfirmations;
      }
      case 'ALGORAND': {
        // Algorand has instant finality (1 block = confirmed)
        const token = this.kms.getKey('ALGORAND', 'apiToken');
        const server = this.kms.getKey('ALGORAND', 'rpcUrl');
        const port = process.env.ALGOD_PORT || '';
        const algodClient = new algosdk.Algodv2(token, server, port);
        try {
          const txInfo = await algodClient.pendingTransactionInformation(txHash).do();
          return txInfo && (txInfo as any).confirmedRound && (txInfo as any).confirmedRound > 0;
        } catch {
          return false;
        }
      }
      default:
        return false;
    }
  }

  private async checkConfirmationsForChain(chain: string): Promise<number> {
    let confirmedCount = 0;

    const pendingDeposits = await prisma.deposit.findMany({
      where: { status: 'PENDING', chain },
    });

    for (const deposit of pendingDeposits) {
      const isConfirmed = await this.verifyConfirmations(
        deposit.chain as SupportedObserverChain,
        deposit.txHash,
        deposit.requiredConfirmations
      );

      if (isConfirmed) {
        await prisma.deposit.update({
          where: { id: deposit.id },
          data: {
            status: 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });
        confirmedCount++;
      }
    }

    return confirmedCount;
  }

  // ----------------------------------------------------------
  // DEPOSIT UPSERT (IDEMPOTENCY)
  // ----------------------------------------------------------

  private async upsertDeposit(data: {
    tenantId: string;
    walletId: string;
    txHash: string;
    amount: string;
    currency: string;
    assetAddress: string;
    chain: string;
    blockNumber: string;
    requiredConfirmations: number;
    metadata: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await prisma.deposit.create({ data });
      console.log(
        `[BlockchainObserver] New deposit detected: ${data.txHash} ` +
        `(${data.amount} ${data.currency}) on ${data.chain}`
      );
      return true;
    } catch (err: any) {
      // Unique constraint violation = already processed
      if (err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  private getEVMProvider(chain: string, rpcUrl?: string): ethers.JsonRpcProvider {
    const cacheKey = chain;
    if (!this.providers.has(cacheKey)) {
      const url = rpcUrl || this.kms.getKey(chain as any, 'rpcUrl');
      this.providers.set(cacheKey, new ethers.JsonRpcProvider(url));
    }
    return this.providers.get(cacheKey)!;
  }

  private loadChainConfigs(): ChainObserverConfig[] {
    const configs: ChainObserverConfig[] = [];

    // Polygon
    const polygonUsdc = process.env.POLYGON_USDC_CONTRACT;
    const polygonUsdt = process.env.POLYGON_USDT_CONTRACT;
    if (polygonUsdc || polygonUsdt) {
      configs.push({
        chain: 'POLYGON',
        rpcUrl: this.kms.getKey('POLYGON', 'rpcUrl'),
        confirmationThreshold: parseInt(
          process.env.DEPOSIT_CONFIRMATIONS_POLYGON || '12',
          10
        ),
        stablecoinContracts: [
          ...(polygonUsdc ? [{ address: polygonUsdc, symbol: 'USDC' }] : []),
          ...(polygonUsdt ? [{ address: polygonUsdt, symbol: 'USDT' }] : []),
        ],
      });
    }

    // Ethereum
    const ethUsdc = process.env.ETHEREUM_USDC_CONTRACT;
    const ethUsdt = process.env.ETHEREUM_USDT_CONTRACT;
    if (ethUsdc || ethUsdt) {
      configs.push({
        chain: 'ETHEREUM',
        rpcUrl: this.kms.getKey('ETHEREUM', 'rpcUrl'),
        confirmationThreshold: parseInt(
          process.env.DEPOSIT_CONFIRMATIONS_ETHEREUM || '12',
          10
        ),
        stablecoinContracts: [
          ...(ethUsdc ? [{ address: ethUsdc, symbol: 'USDC' }] : []),
          ...(ethUsdt ? [{ address: ethUsdt, symbol: 'USDT' }] : []),
        ],
      });
    }

    // Algorand
    const algoUsdc = process.env.ALGORAND_USDC_ASA_ID;
    if (algoUsdc) {
      configs.push({
        chain: 'ALGORAND',
        rpcUrl: this.kms.getKey('ALGORAND', 'rpcUrl'),
        confirmationThreshold: parseInt(
          process.env.DEPOSIT_CONFIRMATIONS_ALGORAND || '0',
          10
        ),
        stablecoinContracts: [{ address: algoUsdc, symbol: 'USDC' }],
      });
    }

    return configs;
  }
}

