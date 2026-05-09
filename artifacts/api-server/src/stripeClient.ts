import Stripe from 'stripe';
import type { StripeSync } from 'stripe-replit-sync';

export async function getUncachableStripeClient(): Promise<Stripe> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  // apiVersion cast required: SDK types lag behind the latest API version string
  return new Stripe(secretKey, { apiVersion: '2025-08-27.basil' as Stripe.LatestApiVersion });
}

export async function getStripePublishableKey(): Promise<string> {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error('STRIPE_PUBLISHABLE_KEY not set');
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  return secretKey;
}

let stripeSyncInstance: StripeSync | null = null;

export async function getStripeSync() {
  if (!stripeSyncInstance) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();
    stripeSyncInstance = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSyncInstance;
}
