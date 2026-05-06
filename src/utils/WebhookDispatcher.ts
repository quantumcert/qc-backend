import crypto from 'crypto';
import prisma from '../config/prisma';

export class WebhookDispatcher {
    /**
     * Dispatch an event to all active webhooks of a tenant
     * 
     * @param tenantId The ID of the tenant to notify
     * @param eventType The type of event (e.g. 'CONTACT_LOG_CREATED', 'EVENT_LOG_CREATED')
     * @param payload The payload representing the event
     */
    static async dispatch(tenantId: string, eventType: string, payload: any) {
        try {
            // Find all active webhooks for the given tenant
            const webhooks = await prisma.tenantWebhook.findMany({
                where: {
                    tenantId,
                    isActive: true
                }
            });

            if (webhooks.length === 0) {
                return; // No active webhooks for this tenant
            }

            const bodyString = JSON.stringify({
                event: eventType,
                timestamp: new Date().toISOString(),
                data: payload
            });

            // Dispatch to each webhook asynchronously
            for (const webhook of webhooks) {
                this.deliverWebhook(webhook, bodyString).catch((err) => {
console.error(`WebhookDispatcher failed to deliver to ${webhook.endpointUrl}:`, err);
                });
            }
        } catch (error) {
            console.error('[WebhookDispatcher] Error fetching webhooks:', error);
        }
    }

    private static async deliverWebhook(webhook: any, bodyString: string) {
        // Generate HMAC SHA-256 signature using the secretKey
        const signature = crypto
            .createHmac('sha256', webhook.secretKey)
            .update(bodyString)
            .digest('hex');

        // Execute native fetch POST
        const response = await fetch(webhook.endpointUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-qc-signature': signature
            },
            body: bodyString
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
    }
}
