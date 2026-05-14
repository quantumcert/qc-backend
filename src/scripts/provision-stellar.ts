import { execFile as execFileCallback, ExecFileOptions } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";
import { Keypair, Networks } from "@stellar/stellar-sdk";

dotenv.config();

const execFileAsync = promisify(execFileCallback) as ExecFileLike;

const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
const DEFAULT_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;
const DEFAULT_CONTRACT_DIR = "contracts/soroban/payment";
const DEFAULT_WASM_OUT_DIR = ".stellar";
const DEFAULT_WASM_PATH = `${DEFAULT_WASM_OUT_DIR}/quantum_cert_payment.wasm`;

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;
type Output = { write(message: string): unknown };
type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
};
type FetchLike = (input: string | URL) => Promise<FetchResponseLike>;

export type ExecFileLike = (
  file: string,
  args: string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface ProvisionStellarOptions {
  env?: EnvMap;
  fetchImpl?: FetchLike;
  execFileImpl?: ExecFileLike;
  stdout?: Output;
  contractDir?: string;
}

export interface ProvisionStellarResult {
  publicKey: string;
  secretKey: string;
  generated: boolean;
  funded: boolean;
  contractId: string;
  env: {
    STELLAR_HORIZON_URL: string;
    STELLAR_SOROBAN_RPC_URL: string;
    STELLAR_NETWORK_PASSPHRASE: string;
    STELLAR_AUTHORITY_SECRET_KEY: string;
    STELLAR_ANCHOR_CONTRACT_ID: string;
  };
}

export async function provisionStellar(
  options: ProvisionStellarOptions = {},
): Promise<ProvisionStellarResult> {
  const env = options.env ?? process.env;
  const execFileImpl = options.execFileImpl ?? execFileAsync;
  const output = options.stdout ?? process.stdout;
  const contractDir = options.contractDir ?? DEFAULT_CONTRACT_DIR;

  const horizonUrl = env.STELLAR_HORIZON_URL ?? DEFAULT_HORIZON_URL;
  const sorobanRpcUrl = env.STELLAR_SOROBAN_RPC_URL ?? DEFAULT_SOROBAN_RPC_URL;
  const networkPassphrase =
    env.STELLAR_NETWORK_PASSPHRASE ?? DEFAULT_NETWORK_PASSPHRASE;

  const existingSecret = normalizeOptionalEnv(env.STELLAR_AUTHORITY_SECRET_KEY);
  const keypair = existingSecret
    ? Keypair.fromSecret(existingSecret)
    : Keypair.random();
  const secretKey = existingSecret ?? keypair.secret();
  const publicKey = keypair.publicKey();
  const generated = !existingSecret;

  await ensureSorobanCli(execFileImpl);

  let funded = false;
  if (generated && networkPassphrase === Networks.TESTNET) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error(
        "fetch is required to fund generated Stellar testnet accounts.",
      );
    }
    await fundWithFriendbot(publicKey, fetchImpl);
    funded = true;
  }

  await execFileImpl(
    "stellar",
    ["contract", "build", "--out-dir", DEFAULT_WASM_OUT_DIR],
    { cwd: contractDir },
  );

  const existingContractId = normalizeOptionalEnv(
    env.STELLAR_ANCHOR_CONTRACT_ID,
  );
  const contractId = isPlaceholderContractId(existingContractId)
    ? await deployContract(execFileImpl, {
        contractDir,
        secretKey,
        publicKey,
        sorobanRpcUrl,
        networkPassphrase,
      })
    : existingContractId;

  const result: ProvisionStellarResult = {
    publicKey,
    secretKey,
    generated,
    funded,
    contractId,
    env: {
      STELLAR_HORIZON_URL: horizonUrl,
      STELLAR_SOROBAN_RPC_URL: sorobanRpcUrl,
      STELLAR_NETWORK_PASSPHRASE: networkPassphrase,
      STELLAR_AUTHORITY_SECRET_KEY: secretKey,
      STELLAR_ANCHOR_CONTRACT_ID: contractId,
    },
  };

  writeProvisioningOutput(output, result);
  return result;
}

async function ensureSorobanCli(execFileImpl: ExecFileLike): Promise<void> {
  try {
    await execFileImpl("stellar", ["--version"]);
  } catch (error) {
    throw new Error(
      "Soroban CLI is required to provision Stellar. Install Stellar CLI and ensure `stellar` is on PATH.",
      { cause: error },
    );
  }
}

async function fundWithFriendbot(
  publicKey: string,
  fetchImpl: FetchLike,
): Promise<void> {
  const url = new URL("https://friendbot.stellar.org");
  url.searchParams.set("addr", publicKey);

  const response = await fetchImpl(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Friendbot funding failed with status ${response.status}: ${body || response.statusText || "unknown error"}`,
    );
  }
}

async function deployContract(
  execFileImpl: ExecFileLike,
  params: {
    contractDir: string;
    secretKey: string;
    publicKey: string;
    sorobanRpcUrl: string;
    networkPassphrase: string;
  },
): Promise<string> {
  const deploy = await execFileImpl(
    "stellar",
    [
      "contract",
      "deploy",
      "--wasm",
      DEFAULT_WASM_PATH,
      "--source-account",
      params.secretKey,
      "--rpc-url",
      params.sorobanRpcUrl,
      "--network-passphrase",
      params.networkPassphrase,
    ],
    { cwd: params.contractDir },
  );
  const contractId = extractContractId(String(deploy.stdout));
  if (!contractId) {
    throw new Error(
      "Stellar contract deploy did not return STELLAR_ANCHOR_CONTRACT_ID.",
    );
  }
  await execFileImpl(
    "stellar",
    [
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source-account",
      params.secretKey,
      "--rpc-url",
      params.sorobanRpcUrl,
      "--network-passphrase",
      params.networkPassphrase,
      "--",
      "initialize",
      "--admin",
      params.publicKey,
    ],
    { cwd: params.contractDir },
  );
  return contractId;
}

function writeProvisioningOutput(
  output: Output,
  result: ProvisionStellarResult,
): void {
  const lines = [
    "",
    "Stellar testnet provisioning complete.",
    `Authority public key: ${result.publicKey}`,
    result.generated
      ? "Generated STELLAR_AUTHORITY_SECRET_KEY. Store it in your secret manager or local .env; do not commit it."
      : "Reused STELLAR_AUTHORITY_SECRET_KEY from environment.",
    result.funded
      ? "Friendbot funded the generated testnet account."
      : "Friendbot funding skipped; existing authority credentials are assumed to be funded.",
    "",
    "Set these environment variables outside tracked files:",
    formatEnvLine("STELLAR_HORIZON_URL", result.env.STELLAR_HORIZON_URL),
    formatEnvLine(
      "STELLAR_SOROBAN_RPC_URL",
      result.env.STELLAR_SOROBAN_RPC_URL,
    ),
    formatEnvLine(
      "STELLAR_NETWORK_PASSPHRASE",
      result.env.STELLAR_NETWORK_PASSPHRASE,
    ),
    formatEnvLine(
      "STELLAR_AUTHORITY_SECRET_KEY",
      result.env.STELLAR_AUTHORITY_SECRET_KEY,
    ),
    formatEnvLine(
      "STELLAR_ANCHOR_CONTRACT_ID",
      result.env.STELLAR_ANCHOR_CONTRACT_ID,
    ),
    "",
  ];

  output.write(`${lines.join("\n")}\n`);
}

function formatEnvLine(key: string, value: string): string {
  return `${key}="${value.replace(/"/g, '\\"')}"`;
}

function normalizeOptionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isPlaceholderContractId(
  contractId: string | undefined,
): contractId is undefined {
  if (!contractId) return true;
  return (
    /^C0+$/.test(contractId) || contractId === "your_anchor_contract_id_here"
  );
}

function extractContractId(output: string): string | undefined {
  const match = output.match(/\bC[A-Z0-9]{20,}\b/);
  return match?.[0];
}

if (require.main === module) {
  provisionStellar().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
