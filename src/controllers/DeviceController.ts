// ═══════════════════════════════════════════════════════════
// DEVICE CONTROLLER
// Architecture: EIP-2535 Faceted Diamond Pattern
// Phase 2: Zero Knowledge Security
//
// GOLDEN RULE: 100% AGNOSTIC — Universal terms only.
// ═══════════════════════════════════════════════════════════

import { Response, Request } from 'express';
import { DeviceGuardFacet } from '../services/core-facets/DeviceGuardFacet';
import { AuthenticatedRequest, DiamondFacets, ApiResponse } from '../types';
import { z } from 'zod';

// Validators
const RegisterDeviceSchema = z.object({
    uid: z.string().min(14), // Standard NFC UID length
    initialCounter: z.number().int().nonnegative().optional()
});

export class DeviceController {
    /**
     * POST /v1/devices
     * Authenticated: Create/Register hardware
     */
    static async register(req: AuthenticatedRequest, res: Response) {
        const tenantId = req.tenantId!;
        const body = RegisterDeviceSchema.parse(req.body);

        const device = await DeviceGuardFacet.registerDevice({
            tenantId,
            ...body
        });

        const response: ApiResponse = {
            success: true,
            data: device,
            meta: {
                timestamp: new Date().toISOString(),
                facet: DiamondFacets.DEVICE_GUARD
            }
        };

        res.status(201).json(response);
    }

    /**
     * GET /v1/devices/tap
     * Public/Authenticated: Validate a physical tap from URL
     * Example: ?uid=04A1B2...&ctr=5&cmac=1A2B3D...
     */
    static async validateTap(req: Request, res: Response) {
        // This endpoint can be public but still needs tenant context 
        // usually derived from the URL structure or a dedicated parameter.
        // For Phase 2, we assume a tenant-scoped API key OR a tenantId parameter.

        const tenantId = (req as AuthenticatedRequest).tenantId || req.query.tenantId as string;

        if (!tenantId) {
            return res.status(400).json({ success: false, error: 'Missing tenantId context' });
        }

        const query = z.object({
            uid: z.string(),
            ctr: z.string().transform(v => parseInt(v)),
            cmac: z.string()
        }).parse(req.query);

        const result = await DeviceGuardFacet.validateAndRecordTap({
            uid: query.uid.toUpperCase(),
            ctr: query.ctr,
            cmac: query.cmac.toUpperCase(),
            tenantId,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            rawUrl: req.originalUrl
        });

        const response: ApiResponse = {
            success: result.verdict === 'VALID',
            data: result,
            meta: {
                timestamp: new Date().toISOString(),
                facet: DiamondFacets.DEVICE_GUARD
            }
        };

        // If result.verdict is not VALID, we still return 200 (or 403) but with success: false
        const status = result.verdict === 'VALID' ? 200 : 403;
        res.status(status).json(response);
    }
}
