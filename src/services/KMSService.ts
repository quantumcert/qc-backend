// ============================================================
// KMS SERVICE -- Key Management Service Abstraction
// Singleton. Custodial model: adapters NEVER access .env directly.
// All private keys are requested from KMS at runtime.
//
// Security Levels:
//   - DEV: Reads from process.env (with warnings)
//   - PROD: Should integrate with AWS KMS, HashiCorp Vault, etc.
//
// WARNING: Never log keys. Never expose keys in error messages.
// ============================================================

export type ChainKeyType = 'privateKey' | 'rpcUrl' | 'mnemonic' | 'secretKey' | 'apiToken';

export interface KeyEntry {
  value: string;
  keyType: ChainKeyType;
  createdAt: Date;
  rotatedAt?: Date;
}

export type SupportedChainForKMS =
  | 'ETHEREUM'
  | 'POLYGON'
  | 'SOLANA'
  | 'STELLAR'
  | 'ALGORAND';

export class KMSService {
  private static instance: KMSService;
  private keyCache: Map<string, KeyEntry> = new Map();
  private isProduction: boolean;

  private constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    if (!this.isProduction) {
      console.warn(
        '[KMSService] WARNING: Running in DEV mode. Keys are loaded from environment variables. ' +
        'In production, configure a secure backend (AWS KMS, Vault, etc.).'
      );
    }
  }

  static getInstance(): KMSService {
    if (!KMSService.instance) {
      KMSService.instance = new KMSService();
    }
    return KMSService.instance;
  }

  /**
   * Retrieves a key for a specific chain and key type.
   * In DEV mode, reads from process.env.
   * In PROD mode, should read from external vault.
   */
  getKey(chain: SupportedChainForKMS, keyType: ChainKeyType): string {
    const cacheKey = `${chain}:${keyType}`;

    // In test environment, always re-read from env to avoid stale cache
    // when tests delete env vars
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;
    if (!isTest && this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)!.value;
    }

    const envVarName = this.resolveEnvVarName(chain, keyType);
    const value = this.resolveKeyFromEnv(chain, keyType);

    if (!value) {
      throw new Error(
        `${envVarName || `${chain}_${keyType}`} is not defined in the environment.`
      );
    }

    this.keyCache.set(cacheKey, {
      value,
      keyType,
      createdAt: new Date(),
    });

    return value;
  }

  /**
   * Lists all active keys (metadata only, no values).
   */
  listActiveKeys(): Array<{ chain: string; keyType: ChainKeyType; createdAt: Date; rotatedAt?: Date }> {
    const result = [];
    for (const [cacheKey, entry] of this.keyCache.entries()) {
      const [chain] = cacheKey.split(':');
      result.push({
        chain,
        keyType: entry.keyType,
        createdAt: entry.createdAt,
        rotatedAt: entry.rotatedAt,
      });
    }
    return result;
  }

  /**
   * Rotates a key by removing it from cache (forces reload on next access).
   * In PROD mode, this would trigger a vault rotation.
   */
  rotateKey(chain: SupportedChainForKMS, keyType: ChainKeyType): void {
    const cacheKey = `${chain}:${keyType}`;
    const entry = this.keyCache.get(cacheKey);
    if (entry) {
      entry.rotatedAt = new Date();
      this.keyCache.delete(cacheKey);
      console.log(`[KMSService] Key rotated: ${chain}:${keyType}`);
    }
  }

  /**
   * Clears the entire key cache. Use with caution.
   */
  clearCache(): void {
    this.keyCache.clear();
    console.log('[KMSService] Key cache cleared.');
  }

  private resolveEnvVarName(chain: SupportedChainForKMS, keyType: ChainKeyType): string | undefined {
    const envMap: Record<string, Record<ChainKeyType, string>> = {
      ETHEREUM: {
        privateKey: 'ETHEREUM_PRIVATE_KEY',
        rpcUrl: 'ETHEREUM_RPC_URL',
        mnemonic: '',
        secretKey: '',
        apiToken: '',
      },
      POLYGON: {
        privateKey: 'POLYGON_PRIVATE_KEY',
        rpcUrl: 'POLYGON_RPC_URL',
        mnemonic: '',
        secretKey: '',
        apiToken: '',
      },
      SOLANA: {
        privateKey: 'SOLANA_AUTHORITY_PRIVATE_KEY',
        rpcUrl: 'SOLANA_RPC_URL',
        mnemonic: '',
        secretKey: '',
        apiToken: '',
      },
      STELLAR: {
        privateKey: '',
        rpcUrl: 'STELLAR_HORIZON_URL',
        mnemonic: '',
        secretKey: 'STELLAR_AUTHORITY_SECRET_KEY',
        apiToken: '',
      },
      ALGORAND: {
        privateKey: '',
        rpcUrl: 'ALGOD_SERVER',
        mnemonic: 'ALGORAND_MASTER_MNEMONIC',
        secretKey: '',
        apiToken: 'ALGOD_TOKEN',
      },
    };

    return envMap[chain]?.[keyType] || undefined;
  }

  private resolveKeyFromEnv(chain: SupportedChainForKMS, keyType: ChainKeyType): string | undefined {
    const varName = this.resolveEnvVarName(chain, keyType);
    if (!varName) {
      return undefined;
    }
    return process.env[varName];
  }
}

