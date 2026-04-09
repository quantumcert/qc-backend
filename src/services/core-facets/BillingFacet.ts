import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import prisma from '../../config/prisma';

export class BillingFacet {
    static getClient() {
        // Master Admin configuration for MercadoPago integration
        const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'TEST-123';
        return new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    }

    /**
     * Creates a payment preference to initiate the checkout flow.
     */
    static async createPaymentPreference(secureContext: any, payload: { assetId: string, amount: number, title: string, ownerEmail: string }) {
        const { assetId, amount, title, ownerEmail } = payload;

        const client = this.getClient();
        const preference = new Preference(client);

        const response = await preference.create({
            body: {
                items: [{
                    id: assetId,
                    title: title,
                    quantity: 1,
                    unit_price: amount
                }],
                payer: {
                    email: ownerEmail
                },
                external_reference: assetId, // Map back to asset securely
                back_urls: {
                    success: 'https://qc-frontend.vercel.app/success',
                    failure: 'https://qc-frontend.vercel.app/failure',
                    pending: 'https://qc-frontend.vercel.app/pending'
                },
                auto_return: 'approved'
            }
        });

        return { initPoint: response.init_point, preferenceId: response.id };
    }

    /**
     * Webhook listener to process Mercado Pago events.
     * Alters status of pending entities based on payment confirmation.
     */
    static async processPaymentWebhook(secureContext: any, payload: any) {
        // Red Team Note: secureContext here would just be public for webhook or validate MP origin
        const paymentId = payload.data?.id || payload.id;

        if (!paymentId) return { success: false, error: 'No payment ID' };

        const client = this.getClient();
        const paymentEndpoint = new Payment(client);
        const payment = await paymentEndpoint.get({ id: paymentId });

        if (payment.status === 'approved') {
            const assetId = payment.external_reference;

            // Trigger transfer conclusion or activation based on asset state
            const asset = await prisma.asset.findUnique({ where: { id: assetId! } });

            if (asset && asset.status === 'AWAITING_PAYMENT') {
                // Lock the update cleanly
                await prisma.asset.update({
                    where: { id: asset.id },
                    data: { status: 'ACTIVE' }
                });

                // Trigger an event log for the payment confirmation
                await prisma.eventLog.create({
                    data: {
                        assetId: asset.id,
                        tenantId: asset.tenantId,
                        origin: 'SYSTEM_BILLING',
                        status: 'APPROVED',
                        payload: { action: 'PAYMENT_CONFIRMED', mpPaymentId: paymentId }
                    }
                });

                console.log(`[BillingFacet] Payment approved for Asset ${asset.id}. Status updated to ACTIVE.`);
                return { success: true, assetId: asset.id };
            }
        }

        return { success: false, status: payment.status };
    }
}
