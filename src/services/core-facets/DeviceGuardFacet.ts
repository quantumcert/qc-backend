// ═══════════════════════════════════════════════════════════
// DEVICE GUARD FACET — ANTI-REPLAY GUARDIAN
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 2: Zero Knowledge Security
//
// Manages hardware state and enforces monotonic counter rules.
// Heart of the anti-cloning and anti-replay protection.
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import prisma from '../../config/prisma';
import { NfcValidationFacet } from './NfcValidationFacet';
import { ContextRouterFacet } from './ContextRouterFacet';
import { CryptoService } from '../CryptoService';
import { TapVerdict, NfcTapResult, AuditActions, ResourceTypes } from '../../types';

export class DeviceGuardFacet {
    /**
     * Entry point for a physical NFC tap.
     * Performs cryptographic validation + monotonic counter check.
     */
    static async validateAndRecordTap(params: {
        uid: string;
        ctr: number;
        cmac: string;
        tenantId: string;
        ipAddress?: string;
        userAgent?: string;
        rawUrl?: string;
    }): Promise<NfcTapResult | any> {
        const { uid, ctr, cmac, tenantId, ipAddress, userAgent, rawUrl } = params;

        // 1. Fetch the device state
        const device = await prisma.device.findUnique({
            where: { uid },
            include: { asset: { select: { id: true, status: true } } }
        });

        if (!device) {
            return {
                verdict: TapVerdict.DEVICE_NOT_FOUND,
                message: 'Device not registered in the system',
                counter: ctr
            };
        }

        // 2. Tenant Isolation Check
        if (device.tenantId !== tenantId) {
            return {
                verdict: TapVerdict.DEVICE_NOT_FOUND,
                message: 'Unauthorized device access',
                counter: ctr
            };
        }

        // 3. Status Check
        if (!device.isActive) {
            return {
                verdict: TapVerdict.DEVICE_INACTIVE,
                message: 'Device is deactivated',
                counter: ctr
            };
        }

        // 4. ANTI-REPLAY RULE: Incoming CTR must be STRICTLY GREATER than lastCounter
        if (ctr <= device.lastCounter) {
            await this.logTap(device.id, ctr, cmac, false, TapVerdict.REPLAY_BLOCKED, params);
            return {
                verdict: TapVerdict.REPLAY_BLOCKED,
                deviceId: device.id,
                counter: ctr,
                message: 'Replay attempt detected. Counter must advance.'
            };
        }

        // 🔴 ZERO-KNOWLEDGE: Extract and Decrypt Master Key strictly in memory
        let sessionMasterKey: string | undefined = undefined;
        if (device.masterKey) {
            sessionMasterKey = CryptoService.decryptJson(device.masterKey) as string;
        }

        // 5. CRYPTOGRAPHIC VALIDATION (SUN CMAC)
        const cryptoCheck = NfcValidationFacet.validateSunCmac({
            uid,
            ctr,
            cmacReceived: cmac,
            masterKey: sessionMasterKey
        });

        if (!cryptoCheck.isValid) {
            await this.logTap(device.id, ctr, cmac, false, TapVerdict.CMAC_INVALID, { ...params, message: cryptoCheck.error });
            return {
                verdict: TapVerdict.CMAC_INVALID,
                deviceId: device.id,
                counter: ctr,
                message: cryptoCheck.error || 'INVALID_CMAC_SIGNATURE'
            };
        }

        // 6. ATOMIC UPDATE & FINAL SUCCESS LOG
        try {
            await prisma.$transaction(async (tx) => {
                // RED TEAM HOTFIX 2 (Hardware Race Condition): Atomic Cond Update
                const updateCount = await tx.device.updateMany({
                    where: {
                        id: device.id,
                        lastCounter: { lt: ctr } // ONLY update if physical ctr is logically ahead AT THE SQL LEVEL
                    },
                    data: {
                        lastCounter: ctr,
                        lastTapAt: new Date(),
                        lastTapIp: ipAddress,
                        totalTaps: { increment: 1 }
                    }
                });

                if (updateCount.count === 0) {
                    throw new Error("P2025_RACE_CONDITION");
                }

                // Log the tap
                await tx.deviceTapLog.create({
                    data: {
                        deviceId: device.id,
                        counterValue: ctr,
                        cmacReceived: cmac,
                        cmacValid: true,
                        verdict: TapVerdict.VALID,
                        ipAddress,
                        userAgent,
                        rawUrl
                    }
                });

                // Audit
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        action: AuditActions.NFC_TAP_VALID,
                        resourceType: ResourceTypes.DEVICE,
                        resourceId: device.id,
                        metadata: { ctr, uid }
                    }
                });
            });
        } catch (error: any) {
            if (error.message === 'P2025_RACE_CONDITION') {
                await this.logTap(device.id, ctr, cmac, true, TapVerdict.REPLAY_BLOCKED, { ...params, message: "Quantum Phantom Replay Blocked by SQL Atomic Lock" });
                return {
                    verdict: TapVerdict.REPLAY_BLOCKED,
                    deviceId: device.id,
                    counter: ctr,
                    message: 'Quantum Race Condition Blocked. Phantom replica mitigated.'
                };
            }
            throw error;
        }

        // 🔴 ORCHESTRATOR FIX: Context Injection Pós-Tap
        let contextData = null;
        if (device.asset?.id) {
            // Load Context through the ContextRouterFacet (Public Profile Filtering)
            contextData = await ContextRouterFacet.routeAssetRead(device.asset.id, { isAuthenticated: false });
        }

        return {
            valid: true, // Legacy compatibility alias or expected shape 
            verdict: TapVerdict.VALID,
            status: device.asset ? device.asset.status : 'UNLINKED',
            assetId: device.asset?.id,
            publicData: contextData ? contextData.asset : null,
            message: 'Tap validated securely and asset context loaded.'
        };
    }

    /**
     * Registers a new Device (NFC Chip)
     */
    static async registerDevice(payload: { tenantId: string, uid: string, initialCounter?: number }) {
        const { tenantId, uid, initialCounter = 0 } = payload;

        return await prisma.device.create({
            data: {
                uid: uid.toUpperCase(),
                tenantId,
                lastCounter: initialCounter,
                isActive: true
            }
        });
    }

    /**
     * Helper to log failed/rejected taps.
     */
    private static async logTap(deviceId: string, ctr: number, cmac: string, cmacValid: boolean, verdict: TapVerdict, context: any) {
        await prisma.deviceTapLog.create({
            data: {
                deviceId,
                counterValue: ctr,
                cmacReceived: cmac,
                cmacValid,
                verdict,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                rawUrl: context.rawUrl
            }
        });

        await prisma.auditLog.create({
            data: {
                tenantId: context.tenantId,
                action: verdict === TapVerdict.REPLAY_BLOCKED ? AuditActions.NFC_TAP_REPLAY_BLOCKED : AuditActions.NFC_TAP_CMAC_INVALID,
                resourceType: ResourceTypes.DEVICE,
                resourceId: deviceId,
                metadata: { ctr, verdict, message: context.message }
            }
        });
    }
}
