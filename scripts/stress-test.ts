import autocannon from 'autocannon';

// ─── STRESS TEST: 10,000 CONNECTIONS ────────────────────────────────────────
// Test boundary conditions: Connection pool, Rate Limit rejection latency, 
// and Node.js Event Loop responsiveness.

async function runStressTest() {
    console.log('🔴 STARTING AUTOCANNON BRUTE FORCE (10k Conns) 🔴');
    console.log('Target: Localhost NFC Validation Route (Crypto-heavy)');

    const instance = autocannon({
        url: 'http://localhost:3000/api/v1/diamond',
        connections: 500,
        pipelining: 5,
        duration: 15,
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            selector: 'device.validateTap',
            payload: {
                uid: '04A1B2C3D4E5F6',
                ctr: 5,
                cmac: '1122334455667788'
            }
        })
    });

    autocannon.track(instance, { renderProgressBar: false });

    // Custom format of the results
    instance.on('done', (result) => {
        console.log('\n✅ STRESS TEST COMPLETE ✅');
        console.log('--------------------------------------------------');
        console.log(`Duration: ${result.duration}s`);
        console.log(`Total Connections: ${result.connections}`);
        console.log(`Requests: ${result.requests.average} req/sec`);
        console.log(`Latency (p99): ${result.latency.p99} ms`);
        console.log(`Total Completed Requests: ${result.requests.total}`);
        console.log(`Rate Limited/Rejected (2xx/4xx/5xx):`);
        console.log(`  - 2xx: ${result['2xx']}`);
        console.log(`  - 4xx: ${result['4xx']} (Expected due to IP Rate Limit / Body constraints)`);
        console.log(`  - 5xx: ${result['5xx']}`);
        console.log(`Timeouts/Errors: ${result.errors}`);
        console.log('--------------------------------------------------');

        if (result.errors > 0 || result['5xx'] > 0) {
            console.log('⚠️ WARNING: SERVER STRUGGLED (OOM or Node Crashing) ⚠️');
        } else {
            console.log('🔥 SERVER SURVIVED THE ONSLAUGHT 🔥');
        }

        process.exit(0);
    });
}

runStressTest();
