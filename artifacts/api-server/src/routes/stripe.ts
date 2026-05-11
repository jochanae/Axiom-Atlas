import { Router } from 'express';
import { stripeStorage } from '../stripeStorage';
import { stripeService } from '../stripeService';
// stripeStorage kept for subscription/user helpers below
import { requireAuth } from './auth';

const router = Router();

// Public: list products with prices — fetched live from Stripe API
router.get('/stripe/products', async (req, res) => {
  try {
    const products = await stripeService.listProductsWithPrices();
    res.json({ data: products });
  } catch (err: any) {
    req.log.error({ err }, 'Failed to list products');
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// Authenticated: get current user's subscription status
router.get('/stripe/subscription', requireAuth, async (req: any, res): Promise<void> => {
  try {
    const user = await stripeStorage.getUser(req.authUser.id);
    if (!user?.stripeSubscriptionId) {
      res.json({ subscription: null, tier: user?.subscriptionTier ?? 'free' }); return;
    }
    const subscription = await stripeStorage.getSubscription(user.stripeSubscriptionId);
    res.json({ subscription, tier: user.subscriptionTier });
  } catch (err: any) {
    req.log.error({ err }, 'Failed to get subscription');
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Authenticated: create checkout session
router.post('/stripe/checkout', requireAuth, async (req: any, res): Promise<void> => {
  try {
    const { priceId } = req.body as { priceId: string };
    if (!priceId) { res.status(400).json({ error: 'priceId required' }); return; }

    let user = await stripeStorage.getUser(req.authUser.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeService.createCustomer(user.email, user.id);
      user = await stripeStorage.updateUserStripeInfo(user.id, { stripeCustomerId: customer.id });
      customerId = customer.id;
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const session = await stripeService.createCheckoutSession(
      customerId!,
      priceId,
      `${baseUrl}/?checkout=success`,
      `${baseUrl}/?checkout=cancel`
    );

    res.json({ url: session.url });
  } catch (err: any) {
    req.log.error({ err }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Authenticated: open customer billing portal
router.post('/stripe/portal', requireAuth, async (req: any, res): Promise<void> => {
  try {
    let user = await stripeStorage.getUser(req.authUser.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeService.createCustomer(user.email, user.id);
      user = await stripeStorage.updateUserStripeInfo(user.id, { stripeCustomerId: customer.id });
      customerId = customer.id;
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const portal = await stripeService.createCustomerPortalSession(customerId!, baseUrl);
    res.json({ url: portal.url });
  } catch (err: any) {
    req.log.error({ err }, 'Failed to create portal session');
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Authenticated: get stripe publishable key (for frontend)
router.get('/stripe/config', async (_req, res) => {
  try {
    const { getStripePublishableKey } = await import('../stripeClient');
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (err: any) {
    res.status(500).json({ error: 'Stripe not configured' });
  }
});

export default router;
