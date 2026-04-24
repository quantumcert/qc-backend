import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    server: {
      deps: {
        inline: ['uuid'],
      },
    },
  },
  resolve: {
    alias: {
      '@stellar/stellar-sdk/rpc': path.resolve(__dirname, '__mocks__/@stellar/stellar-sdk/rpc.ts'),
      '@stellar/stellar-sdk': path.resolve(__dirname, '__mocks__/@stellar/stellar-sdk.ts'),
    },
  },
});


