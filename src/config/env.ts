import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('24h'),

  // Algorand
  ALGORAND_QC_ACCOUNT_MNEMONIC: z.string().optional(),
  ALGORAND_ALGOD_SERVER: z
    .string()
    .default('https://testnet-api.algonode.cloud'),
  ALGORAND_ALGOD_TOKEN: z.string().default(''),
  ALGORAND_NETWORK: z.string().default('testnet'),

  // Falcon-512 (Post-Quantum Crypto)
  FALCON_ENCRYPTION_KEY: z.string().optional(),
  LIBOQS_PATH: z.string().default('/usr/local/bin/oqs'),

  // Server
  PORT: z.string().default('3000'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PUBLIC_CONSULTATION_URL_BASE: z.string().url().optional(),

  // Quantum Cert
  QUANTUM_CERT_SECRET: z.string().optional(),

  // Blockchain Observer (Custodial Deposit Flow)
  BLOCKCHAIN_OBSERVER_INTERVAL_SECONDS: z.string().default('30'),
  POLYGON_USDC_CONTRACT: z.string().optional(),
  POLYGON_USDT_CONTRACT: z.string().optional(),
  ETHEREUM_USDC_CONTRACT: z.string().optional(),
  ETHEREUM_USDT_CONTRACT: z.string().optional(),
  ALGORAND_USDC_ASA_ID: z.string().optional(),
  DEPOSIT_CONFIRMATIONS_POLYGON: z.string().default('12'),
  DEPOSIT_CONFIRMATIONS_ETHEREUM: z.string().default('12'),
  DEPOSIT_CONFIRMATIONS_ALGORAND: z.string().default('0'),

  // Optional document verification payment gate
  X402_ENABLED: z.string().default('false'),
  X402_PROVIDER: z.string().optional(),
  X402_ANCHOR_PROVIDER: z.string().default('transfero'),
  X402_ASSET_CODE: z.string().default('BRZ'),
  X402_PRICE: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    // Non-blocking in development: log warnings instead of crashing
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment configuration');
    }
    console.warn(
      'Running with partial environment configuration (development mode)',
    );
    // Return a partial env with defaults
    return {
      DATABASE_URL: process.env.DATABASE_URL || '',
      JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
      ALGORAND_QC_ACCOUNT_MNEMONIC: process.env.ALGORAND_QC_ACCOUNT_MNEMONIC,
      ALGORAND_ALGOD_SERVER:
        process.env.ALGORAND_ALGOD_SERVER ||
        'https://testnet-api.algonode.cloud',
      ALGORAND_ALGOD_TOKEN: process.env.ALGORAND_ALGOD_TOKEN || '',
      ALGORAND_NETWORK: process.env.ALGORAND_NETWORK || 'testnet',
      FALCON_ENCRYPTION_KEY: process.env.FALCON_ENCRYPTION_KEY,
      LIBOQS_PATH: process.env.LIBOQS_PATH || '/usr/local/bin/oqs',
      PORT: process.env.PORT || '3000',
      NODE_ENV:
        (process.env.NODE_ENV as 'development' | 'production' | 'test') ||
        'development',
      PUBLIC_CONSULTATION_URL_BASE: process.env.PUBLIC_CONSULTATION_URL_BASE,
      QUANTUM_CERT_SECRET: process.env.QUANTUM_CERT_SECRET,
      X402_ENABLED: process.env.X402_ENABLED || 'false',
      X402_PROVIDER: process.env.X402_PROVIDER,
      X402_ANCHOR_PROVIDER: process.env.X402_ANCHOR_PROVIDER || 'transfero',
      X402_ASSET_CODE: process.env.X402_ASSET_CODE || 'BRZ',
      X402_PRICE: process.env.X402_PRICE,
    };
  }

  return parsed.data;
}

export const env = loadEnv();
