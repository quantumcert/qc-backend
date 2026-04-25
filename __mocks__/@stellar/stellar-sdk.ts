export const Keypair = {
  fromSecret: () => ({
    publicKey: () => 'FAKESTELLARPUBKEY',
  }),
};

export class Horizon {
  static Server = class {
    loadAccount = () => Promise.resolve({ id: 'FAKESTELLARPUBKEY', sequence: '0' });
    submitTransaction = () => Promise.resolve({ hash: 'fake_stellar_hash' });
  };
}

export class TransactionBuilder {
  constructor() {}
  setTimeout = () => this;
  addOperation = () => this;
  build = () => ({ sign: () => {}, toXDR: () => 'fake_xdr' });
  static fromXDR = () => ({ sign: () => {}, toXDR: () => 'fake_xdr' });
}

export const Operation = {
  payment: () => ({}),
};

export const Asset = {
  native: () => ({}),
};

export const Networks = {
  PUBLIC: 'Public Global Stellar Network ; September 2015',
};

export class Contract {
  call = () => ({});
}

export const nativeToScVal = (val: any, opts?: any) => val;

export const rpc = {
  Server: class {
    simulateTransaction = () => Promise.resolve({
      transactionData: { build: () => ({ toXDR: () => 'fake_xdr' }) },
    });
    sendTransaction = () => Promise.resolve({
      status: 'PENDING',
      hash: 'fake_soroban_hash',
    });
    getTransaction = () => Promise.resolve({ status: 'SUCCESS' });
  },
  assembleTransaction: (_tx: any, _simulateResult: any) => {
    return { sign: () => {}, toXDR: () => 'fake_xdr' };
  },
};
