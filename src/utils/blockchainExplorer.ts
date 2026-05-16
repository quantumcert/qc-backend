export function buildExplorerUrl(
  chain: string | null | undefined,
  txId: string | null | undefined,
): string | null {
  if (!chain || !txId) return null;

  if (chain === 'STELLAR') {
    return `https://stellar.expert/explorer/testnet/tx/${txId}`;
  }

  return null;
}
