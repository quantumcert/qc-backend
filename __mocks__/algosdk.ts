// __mocks__/algosdk.ts
// Mock for Algorand SDK tests (Vitest compatible)
import { vi } from 'vitest';

const mockAlgodClient = {
  getTransactionParams: () => ({
    do: vi.fn().mockResolvedValue({
      fee: 1000,
      firstRound: 1000,
      lastRound: 2000,
      genesisID: 'testnet-v1.0',
      genesisHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ',
    }),
  }),
  sendRawTransaction: () => ({
    do: vi.fn().mockResolvedValue({ txId: 'fake_algorand_txid' }),
  }),
  accountInformation: () => ({
    do: vi.fn().mockResolvedValue({ amount: 10000000 }),
  }),
  pendingTransactionInformation: () => ({
    do: vi.fn().mockResolvedValue({ confirmedRound: 12345 }),
  }),
};

const mockTxn = {
  signTxn: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  toByte: vi.fn().mockReturnValue(new Uint8Array([4, 5, 6])),
};

export default {
  Algodv2: vi.fn().mockImplementation(() => mockAlgodClient),
  mnemonicToSecretKey: vi.fn().mockReturnValue({
    addr: 'FAKEALGORANDADDRESS',
    sk: new Uint8Array(64),
  }),
  makePaymentTxnWithSuggestedParamsFromObject: vi.fn().mockReturnValue(mockTxn),
  makeAssetTransferTxnWithSuggestedParamsFromObject: vi.fn().mockReturnValue(mockTxn),
  makeAssetCreateTxnWithSuggestedParamsFromObject: vi.fn().mockReturnValue(mockTxn),
  makeAssetConfigTxnWithSuggestedParamsFromObject: vi.fn().mockReturnValue(mockTxn),
  makeAssetFreezeTxnWithSuggestedParamsFromObject: vi.fn().mockReturnValue(mockTxn),
  makeAssetDestroyTxnWithSuggestedParamsFromObject: vi.fn().mockReturnValue(mockTxn),
  assignGroupID: vi.fn(),
};

