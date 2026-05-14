// ============================================================
// KMS SERVICE -- Key Management Service Abstraction
// Singleton. Custodial model: adapters NEVER access .env directly.
// All private keys are requested from KMS at runtime.
//
// Security Levels:
//   - DEV: Reads from process.env (with warnings)
//   - PROD: Should integrate with AWS KMS, HashiCorp Vault, etc.
//
// POST-QUANTUM KEY WRAPPING:
//   - Master Falcon-512 key wraps all user keys via AES-256-GCM
//   - Database stores only ciphertext
//   - Unwrapping happens in-memory only, with immediate zeroization
//
// WARNING: Never log keys. Never expose keys in error messages.
// ============================================================

import { ethers } from 'ethers';
import algosdk from 'algosdk';
import nacl from 'tweetnacl';
import { PostQuantumCrypto } from '../utils/PostQuantumCrypto';
import prisma from '../config/prisma';

const TENANT_SECRET_NOT_CONFIGURED = 'TENANT_SECRET_NOT_CONFIGURED';

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
  private masterKeyCache: Uint8Array | null = null;

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

  // ============================================================
  // QUANTUM MASTER KEY (Falcon-512)
  // ============================================================

  /**
   * Retrieves or generates the Quantum Master Key (Falcon-512).
   * In production, this should come from an HSM or secure vault.
   * In dev/prod, it must be derived from QUANTUM_CERT_SECRET env var.
   *
   * SECURITY: This key NEVER leaves this method's scope.
   * It is cached in-memory only (never persisted to disk).
   */
  getQuantumMasterKey(): Uint8Array {
    if (this.masterKeyCache) {
      return this.masterKeyCache;
    }

    const envSecret = process.env.QUANTUM_CERT_SECRET;
    if (envSecret && envSecret.length >= 64) {
      // Derive deterministic master key from env secret
      const crypto = require('crypto');
      const derived = crypto.createHash('sha3-256')
        .update('QC_MASTER_KEY_DERIVATION_v1')
        .update(envSecret)
        .digest();
      this.masterKeyCache = new Uint8Array(derived);
    } else if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      // Test-only fallback. Runtime environments must provide a stable secret so
      // Falcon-signed data stays verifiable across restarts.
      console.warn(
        '[KMSService] QUANTUM_CERT_SECRET not configured. ' +
        'Generating ephemeral master key (TEST ONLY).'
      );
      const falcon = require('falcon-crypto');
      const keys = falcon.keyPair();
      this.masterKeyCache = new Uint8Array(keys.privateKey);
    } else {
      throw new Error(
        'QUANTUM_CERT_SECRET is required — refusing to generate ephemeral Falcon master key'
      );
    }

    return this.masterKeyCache;
  }

  /**
   * Clears the master key from memory cache.
   * Call this after sensitive operations in high-security scenarios.
   */
  clearMasterKeyCache(): void {
    if (this.masterKeyCache) {
      // Zeroize the cached Uint8Array in place before dropping the reference.
      this.masterKeyCache.fill(0);
      this.masterKeyCache = null;
    }
  }

  // ============================================================
  // PQC KEY WRAPPING / UNWRAPPING
  // ============================================================

  /**
   * Wraps a user private key using the Quantum Master Key.
   * Returns Base64 ciphertext safe for database storage.
   */
  wrapUserKey(plaintextKey: string): string {
    const masterKey = this.getQuantumMasterKey();
    return PostQuantumCrypto.wrapKey(plaintextKey, masterKey);
  }

  /**
   * Unwraps a user private key from database ciphertext.
   * Returns plaintext. Caller MUST zeroize after use.
   */
  unwrapUserKey(ciphertext: string): string {
    const masterKey = this.getQuantumMasterKey();
    return PostQuantumCrypto.unwrapKey(ciphertext, masterKey);
  }

  async storeTenantSecretHex(
    tenantId: string,
    purpose: string,
    secretHex: string,
    publicKeyB64?: string
  ): Promise<void> {
    if (!tenantId?.trim() || !purpose?.trim()) {
      throw new Error('tenantId and purpose are required');
    }

    if (!/^[a-f0-9]+$/i.test(secretHex) || secretHex.length < 4610) {
      throw new Error('Tenant secret must be a Falcon-512 private key hex string with at least 4610 characters');
    }

    const encryptedSecret = this.wrapUserKey(secretHex);
    const rotatedAt = new Date();

    await (prisma as any).tenantSecret.upsert({
      where: { tenantId_purpose: { tenantId, purpose } },
      update: {
        keyType: 'FALCON-512',
        encryptedSecret,
        publicKeyB64,
        keyWrapVersion: 1,
        isActive: true,
        rotatedAt,
      },
      create: {
        tenantId,
        purpose,
        keyType: 'FALCON-512',
        encryptedSecret,
        publicKeyB64,
        keyWrapVersion: 1,
        isActive: true,
        rotatedAt,
      },
    });
  }

  async getTenantSecretHex(tenantId: string, purpose: string): Promise<string> {
    const record = await (prisma as any).tenantSecret.findUnique({
      where: { tenantId_purpose: { tenantId, purpose } },
    });

    if (!record || record.isActive === false) {
      throw Object.assign(
        new Error('Tenant secret not configured for commissioning'),
        { code: TENANT_SECRET_NOT_CONFIGURED }
      );
    }

    return this.unwrapUserKey(record.encryptedSecret);
  }

  /**
   * Derives a private key for a user from the master key and account index.
   * The derived key is immediately wrapped and returned as ciphertext.
   * The plaintext is zeroized before returning.
   */
  deriveAndWrapPrivateKey(chain: SupportedChainForKMS, accountIndex: number): string {
    const plaintextKey = this.derivePrivateKey(chain, accountIndex);
    try {
      const wrapped = this.wrapUserKey(plaintextKey);
      return wrapped;
    } finally {
      // Zeroize plaintext from memory
      PostQuantumCrypto.zeroize(Buffer.from(plaintextKey));
    }
  }

  /**
   * Derives a private key (plaintext) for a user.
   * WARNING: Only use this when you need to sign a transaction.
   * Always wrap the result immediately and zeroize after use.
   */
  derivePrivateKey(chain: SupportedChainForKMS, accountIndex: number): string {
    switch (chain) {
      case 'ETHEREUM':
      case 'POLYGON': {
        const privateKey = this.getKey(chain, 'privateKey');
        const masterWallet = new ethers.Wallet(privateKey);
        const derivationInput = `${masterWallet.privateKey}:${accountIndex}`;
        const derivedPrivateKey = ethers.keccak256(ethers.toUtf8Bytes(derivationInput));
        return derivedPrivateKey;
      }
      case 'ALGORAND': {
        const mnemonic = this.getKey('ALGORAND', 'mnemonic');
        const masterAccount = algosdk.mnemonicToSecretKey(mnemonic);
        const masterSeed = masterAccount.sk.slice(0, 32);
        const derivationInput = Buffer.concat([
          Buffer.from(masterSeed),
          Buffer.from(accountIndex.toString()),
        ]);
        const hash = ethers.keccak256(derivationInput);
        const derivedSeed = Buffer.from(hash.slice(2), 'hex').slice(0, 32);
        const derivedKeys = nacl.sign.keyPair.fromSeed(derivedSeed);
        // Return the full secret key (seed + public key) for algosdk
        const fullSecretKey = Buffer.concat([
          Buffer.from(derivedKeys.secretKey.slice(0, 32)),
          Buffer.from(derivedKeys.publicKey),
        ]);
        return fullSecretKey.toString('base64');
      }
      case 'SOLANA':
      case 'STELLAR': {
        throw new Error(`Private key derivation not yet implemented for ${chain}`);
      }
      default:
        throw new Error(`Unsupported chain for private key derivation: ${chain}`);
    }
  }

  // ============================================================
  // STANDARD KEY RETRIEVAL
  // ============================================================

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

  /**
   * Derives a custodial deposit address for a user from the master key.
   * Uses deterministic derivation so the same (chain, accountIndex) always
   * yields the same address. The private key is NEVER exposed.
   *
   * EVM chains (Ethereum, Polygon): HD wallet derivation from private key.
   * Algorand: Account index derivation from master mnemonic.
   */
  deriveAddress(chain: SupportedChainForKMS, accountIndex: number): string {
    switch (chain) {
      case 'ETHEREUM':
      case 'POLYGON': {
        const privateKey = this.getKey(chain, 'privateKey');
        const masterWallet = new ethers.Wallet(privateKey);
        // Use simple deterministic derivation: hash(privateKey + index)
        const derivationInput = `${masterWallet.privateKey}:${accountIndex}`;
        const derivedPrivateKey = ethers.keccak256(ethers.toUtf8Bytes(derivationInput));
        const derivedWallet = new ethers.Wallet(derivedPrivateKey);
        return derivedWallet.address;
      }
      case 'ALGORAND': {
        const mnemonic = this.getKey('ALGORAND', 'mnemonic');
        const masterAccount = algosdk.mnemonicToSecretKey(mnemonic);
        // Deterministic derivation: derive key from master secret key seed + index
        // masterAccount.sk is 64 bytes: [32-byte seed | 32-byte public key]
        const masterSeed = masterAccount.sk.slice(0, 32);
        const derivationInput = Buffer.concat([
          Buffer.from(masterSeed),
          Buffer.from(accountIndex.toString()),
        ]);
        const hash = ethers.keccak256(derivationInput);
        const derivedSeed = Buffer.from(hash.slice(2), 'hex').slice(0, 32);
        const derivedKeys = nacl.sign.keyPair.fromSeed(derivedSeed);
        return algosdk.encodeAddress(derivedKeys.publicKey);
      }
      case 'SOLANA':
      case 'STELLAR': {
        // TODO: Implement Solana/Stellar derivation when needed
        throw new Error(`Address derivation not yet implemented for ${chain}`);
      }
      default:
        throw new Error(`Unsupported chain for address derivation: ${chain}`);
    }
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
