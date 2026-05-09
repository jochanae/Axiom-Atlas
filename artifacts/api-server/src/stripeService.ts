import { stripeStorage } from './stripeStorage';
import { getUncachableStripeClient } from './stripeClient';

export class StripeService {
  async createCustomer(email: string, userId: number) {
    const stripe = await getUncachableStripeClient();
    return stripe.customers.create({ email, metadata: { userId: String(userId) } });
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string
  ) {
    const stripe = await getUncachableStripeClient();
    return stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }

  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  }

  async listProductsWithPrices() {
    const stripe = await getUncachableStripeClient();
    const [products, prices] = await Promise.all([
      stripe.products.list({ active: true, limit: 20 }),
      stripe.prices.list({ active: true, limit: 50, expand: ['data.product'] }),
    ]);

    return products.data.map(product => ({
      id: product.id,
      name: product.name,
      description: product.description ?? null,
      metadata: product.metadata,
      prices: prices.data
        .filter(p => (typeof p.product === 'string' ? p.product : p.product?.id) === product.id)
        .map(p => ({
          id: p.id,
          unitAmount: p.unit_amount,
          currency: p.currency,
          recurring: p.recurring,
          metadata: p.metadata,
        })),
    }));
  }

  async getProduct(productId: string) {
    return stripeStorage.getProduct(productId);
  }

  async getSubscription(subscriptionId: string) {
    return stripeStorage.getSubscription(subscriptionId);
  }
}

export const stripeService = new StripeService();
