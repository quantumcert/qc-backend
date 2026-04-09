import { Request, Response } from 'express';
import prisma from '../src/config/prisma';
import { DiamondProxy } from '../src/diamond/DiamondProxy';
// @ts-ignore
import { aesCmac } from 'node-aes-cmac';

async function run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('VALIDATING HARDWARE PROVISIONING AND CONTEXT ROUTING');
    console.log('═══════════════════════════════════════════════════════════\n');

    const tenantId = 'tenant-device-' + Date.now();
    const assetId = 'asset-device-' + Date.now();
    const uid = '04A1B2C3D4E5F6'; // MOCK UID
    const masterKeyPlain = '00000000000000000000000000000000'; // 16-byte hex

    try {
        await prisma.tenant.create({
            data: { id: tenantId, name: 'Hardware Tenant', slug: tenantId, contactEmail: 'test@hk.com' }
        });

        // Use AssetRegistryFacet to cleanly create Asset with URL
        const { AssetRegistryFacet } = require('../src/services/core-facets/AssetRegistryFacet');
        const createdAsset = await AssetRegistryFacet.createAsset({
            tenantId,
            metadata: { info: "Hardware Tag" }
        });
        const dynamicAssetId = createdAsset.id;

        // Update to ALERT
        await prisma.asset.update({
            where: { id: dynamicAssetId },
            data: { status: 'ALERT' }
        });

        console.log('[1] Executing device.register (Provisioning)');
        const reqRegister = {
            body: {
                selector: 'device.register',
                args: [dynamicAssetId, tenantId, uid, masterKeyPlain]
            }
        } as Request;

        let registerResData: any = null;
        const resRegister = {
            status: () => ({
                json: (data: any) => { registerResData = data; return data; }
            })
        } as unknown as Response;

        await DiamondProxy.delegateCall(reqRegister, resRegister);

        if (registerResData.success) {
            console.log(`    ✅ Device registered successfully to Asset [${dynamicAssetId}]`);
            console.log(`    Encrypted MasterKey stored in DB: `, registerResData.data.masterKey);
        } else {
            console.error('Registration failed:', registerResData);
            throw new Error('Registration failed');
        }

        console.log('\n[2] Executing device.validateTap (NFC Scan)');

        // Let's generate a valid CMAC for CTR = 1
        const key = Buffer.from(masterKeyPlain, 'hex');
        const ctr = 1;
        const ctrBuf = Buffer.alloc(3);
        ctrBuf.writeUIntBE(ctr, 0, 3);
        const uidBuf = Buffer.from(uid, 'hex');
        const prefix = Buffer.from([0xC1, 0xAD, 0x54]);
        const dToHash = Buffer.concat([prefix, uidBuf, ctrBuf]);
        const rawCmac = aesCmac(key, dToHash) as string;
        const expectedTruncatedCmac = rawCmac.substring(0, 16).toUpperCase();

        const reqTap = {
            body: {
                selector: 'device.validateTap',
                args: [{
                    uid,
                    ctr,
                    cmac: expectedTruncatedCmac,
                    tenantId,
                    ipAddress: '127.0.0.1',
                    userAgent: 'TestBrowser'
                }]
            }
        } as Request;

        let tapResData: any = null;
        const resTap = {
            status: () => ({
                json: (data: any) => { tapResData = data; return data; }
            })
        } as unknown as Response;

        await DiamondProxy.delegateCall(reqTap, resTap);

        if (tapResData.success) {
            console.log(`    ✅ Tap Validated Successfully`);
            console.log('\n    📦 Payload Returned to Frontend:');
            console.log(JSON.stringify(tapResData.data, null, 2));
        } else {
            console.error('Tap failed:', tapResData);
            throw new Error('Tap failed');
        }

    } catch (e: any) {
        console.error("Test failed: ", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

run();
