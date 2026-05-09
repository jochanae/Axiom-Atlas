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

  async getProduct(productId: string) {
    return stripeStorage.getProduct(productId);
  }

  async getSubscription(subscriptionId: string) {
    return stripeStorage.getSubscription(subscriptionId);
  }
}

export const stripeService = new StripeService();
