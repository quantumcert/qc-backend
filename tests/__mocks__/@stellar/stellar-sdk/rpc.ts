import { vi } from 'vitest';

export const Server = vi.fn().mockImplementation(() => ({
  simulateTransaction: vi.fn().mockResolvedValue({
    transactionData: { build: () => ({ toXDR: () => 'fake_xdr' }) },
  }),
  sendTransaction: vi.fn().mockResolvedValue({
    status: 'PENDING',
    hash: 'fake_soroban_hash',
  }),
  getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
}));
