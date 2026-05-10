import { Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE } from 'stellar-sdk';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');

async function fundAccount(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`Friendbot falhou: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const sender = Keypair.random();
  const receiver = Keypair.random();

  console.log('=== KEYPAIRS GERADOS ===');
  console.log('SENDER public key :', sender.publicKey());
  console.log('SENDER secret key :', sender.secret());
  console.log('RECEIVER public key:', receiver.publicKey());

  console.log('\nFinanciando contas via Friendbot...');
  await fundAccount(sender.publicKey());
  await fundAccount(receiver.publicKey());
  console.log('Contas financiadas com 10.000 XLM de teste cada.');

  const account = await server.loadAccount(sender.publicKey());
  console.log('\nSaldo do remetente:', account.balances.find(b => b.asset_type === 'native').balance, 'XLM');

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: receiver.publicKey(),
      asset: Asset.native(),
      amount: '10',
    }))
    .setTimeout(30)
    .build();

  tx.sign(sender);

  console.log('\nSubmetendo transação...');
  const result = await server.submitTransaction(tx);

  console.log('\n=== RESULTADO ===');
  console.log('Chave pública da conta :', sender.publicKey());
  console.log('Hash da transação       :', result.hash);
  console.log('Ledger                  :', result.ledger);
  console.log('Sucesso                 :', result.successful ?? true);
  console.log('\nVerificar em: https://stellar.expert/explorer/testnet/tx/' + result.hash);
}

main().catch(console.error);
