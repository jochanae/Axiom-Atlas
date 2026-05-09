import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { logger } from './lib/logger';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook signature');
    }

    // Verify the signature — rejects anything not genuinely from Stripe
    const stripe = await getUncachableStripeClient();
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    logger.info({ type: event.type, id: event.id }, 'Stripe webhook verified');

    // Hand off to stripe-replit-sync for DB sync
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
  }
}
