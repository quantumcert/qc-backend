import algosdk from 'algosdk';

const Mnemonic = "medal huge swallow verify frog easy climb tennis catalog shadow other trim peanut long color soda humor update basket skill bamboo blood draw absorb east";
const account = algosdk.mnemonicToSecretKey(Mnemonic);

try {
    const params = {
        fee: 1000,
        firstRound: 10000,
        lastRound: 11000,
        genesisID: 'testnet-v1.0',
        genesisHash: 'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=' // Base64
    };

    console.log("Addr is:", account.addr, typeof account.addr);

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: account.addr.toString(),
        receiver: account.addr.toString(),
        amount: 0,
        note: new Uint8Array(Buffer.from("Test")),
        suggestedParams: params as any
    });

    console.log("Success!");
} catch (e: any) {
    console.log(e.stack);
}
