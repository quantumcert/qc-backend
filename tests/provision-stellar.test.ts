import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFromSecret, mockRandom } = vi.hoisted(() => ({
  mockFromSecret: vi.fn(),
  mockRandom: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: mockFromSecret,
    random: mockRandom,
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
  },
}));

import {
  ExecFileLike,
  provisionStellar,
  ProvisionStellarOptions,
} from "../src/scripts/provision-stellar";

function keypair(publicKey: string, secretKey: string) {
  return {
    publicKey: vi.fn(() => publicKey),
    secret: vi.fn(() => secretKey),
  };
}

function createHarness(overrides: Partial<ProvisionStellarOptions> = {}) {
  const writes: string[] = [];
  const execFileImpl: ExecFileLike = vi.fn(async (_file, args) => {
    if (args.includes("deploy")) {
      return {
        stdout: "Contract deployed: CDEPLOYEDSTELLARANCHORCONTRACT001",
        stderr: "",
      };
    }
    return { stdout: "stellar 22.0.0", stderr: "" };
  });
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: vi.fn(async () => "funded"),
  }));
  const stdout = {
    write: vi.fn((message: string) => {
      writes.push(message);
      return true;
    }),
  };

  return {
    env: {},
    execFileImpl,
    fetchImpl,
    stdout,
    writes,
    ...overrides,
  };
}

describe("provisionStellar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFromSecret.mockReturnValue(
      keypair("GEXISTINGAUTHORITY", "SEXISTINGAUTHORITY"),
    );
    mockRandom.mockReturnValue(
      keypair("GGENERATEDAUTHORITY", "SGENERATEDAUTHORITY"),
    );
  });

  it("reuses an existing authority secret and contract id", async () => {
    const harness = createHarness({
      env: {
        STELLAR_AUTHORITY_SECRET_KEY: "SEXISTINGAUTHORITY",
        STELLAR_ANCHOR_CONTRACT_ID: "CEXISTINGSTELLARANCHORCONTRACT001",
      },
    });

    const result = await provisionStellar(harness);

    expect(mockFromSecret).toHaveBeenCalledWith("SEXISTINGAUTHORITY");
    expect(mockRandom).not.toHaveBeenCalled();
    expect(harness.fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      publicKey: "GEXISTINGAUTHORITY",
      secretKey: "SEXISTINGAUTHORITY",
      generated: false,
      funded: false,
      contractId: "CEXISTINGSTELLARANCHORCONTRACT001",
    });
    expect(harness.execFileImpl).toHaveBeenCalledWith(
      "stellar",
      ["contract", "build", "--out-dir", ".stellar"],
      {
        cwd: "contracts/soroban/payment",
      },
    );
  });

  it("generates and funds a testnet authority account when the secret is absent", async () => {
    const harness = createHarness();

    const result = await provisionStellar(harness);

    expect(mockRandom).toHaveBeenCalledOnce();
    expect(harness.fetchImpl).toHaveBeenCalledOnce();
    expect(String(harness.fetchImpl.mock.calls[0][0])).toContain(
      "https://friendbot.stellar.org/?addr=GGENERATEDAUTHORITY",
    );
    expect(result.generated).toBe(true);
    expect(result.funded).toBe(true);
    expect(result.secretKey).toBe("SGENERATEDAUTHORITY");
    expect(result.contractId).toBe("CDEPLOYEDSTELLARANCHORCONTRACT001");
  });

  it("prints all runtime Stellar env vars without writing tracked files", async () => {
    const harness = createHarness();

    await provisionStellar(harness);

    const output = harness.writes.join("");
    expect(output).toContain(
      'STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org"',
    );
    expect(output).toContain(
      'STELLAR_SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"',
    );
    expect(output).toContain(
      'STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
    );
    expect(output).toContain(
      'STELLAR_AUTHORITY_SECRET_KEY="SGENERATEDAUTHORITY"',
    );
    expect(output).toContain(
      'STELLAR_ANCHOR_CONTRACT_ID="CDEPLOYEDSTELLARANCHORCONTRACT001"',
    );
  });

  it("fails fast with an explicit Soroban CLI error when stellar is unavailable", async () => {
    const execFileImpl: ExecFileLike = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const harness = createHarness({ execFileImpl });

    await expect(provisionStellar(harness)).rejects.toThrow(
      "Soroban CLI is required",
    );
  });
});
