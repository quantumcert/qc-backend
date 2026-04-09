import { Request, Response } from 'express';
import { BlindContactLogFacet } from '../services/core-facets/BlindContactLogFacet';
import { ApiResponse } from '../types';
import { z } from 'zod';

const SubmitContactSchema = z.record(z.any());

export class BlindContactController {
    static async submitContact(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const contactData = SubmitContactSchema.parse(req.body);
            const originIp = req.ip || req.connection.remoteAddress || null;

            const blindContact = await BlindContactLogFacet.submitContact(id, contactData, originIp);

            const response: ApiResponse = {
                success: true,
                data: {
                    message: "Contact information recorded successfully and securely relayed to the asset owner."
                },
                meta: {
                    timestamp: new Date().toISOString(),
                    facet: 'BLIND_CONTACT'
                }
            };

            return res.status(201).json(response);
        } catch (error: any) {
            if (error.message === "ASSET_NOT_FOUND") {
                return res.status(404).json({ success: false, error: 'Asset not found' });
            }
            if (error.message === "ASSET_NOT_IN_ALERT") {
                return res.status(403).json({ success: false, error: 'Forbidden. Asset is not accepting contact requests at this time.' });
            }

            console.error('[BlindContactController]', error);
            return res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
}
