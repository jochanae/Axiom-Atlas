import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();
    console.log('Creating Atlas products in Stripe...');

    // ── Pro Plan ──────────────────────────────────────────────
    const existingPro = await stripe.products.search({
      query: "name:'Atlas Pro' AND active:'true'",
    });

    let proProductId: string;

    if (existingPro.data.length > 0) {
      console.log('Atlas Pro already exists, skipping.');
      proProductId = existingPro.data[0].id;
    } else {
      const pro = await stripe.products.create({
        name: 'Atlas Pro',
        description: 'Unlimited projects, permanent vault, full ledger history, project profiles, GitHub integration, and Atlas handoff.',
        metadata: { tier: 'pro' },
      });
      proProductId = pro.id;
      console.log(`Created Atlas Pro: ${pro.id}`);

      await stripe.prices.create({
        product: proProductId,
        unit_amount: 1900,
        currency: 'usd',
        recurring: { interval: 'month' },
        metadata: { billing: 'monthly' },
      });
      console.log('Created Pro monthly price: $19/month');

      await stripe.prices.create({
        product: proProductId,
        unit_amount: 19000,
        currency: 'usd',
        recurring: { interval: 'year' },
        metadata: { billing: 'annual' },
      });
      console.log('Created Pro annual price: $190/year');
    }

    // ── Teams Plan ────────────────────────────────────────────
    const existingTeams = await stripe.products.search({
      query: "name:'Atlas Teams' AND active:'true'",
    });

    if (existingTeams.data.length > 0) {
      console.log('Atlas Teams already exists, skipping.');
    } else {
      const teams = await stripe.products.create({
        name: 'Atlas Teams',
        description: 'Everything in Pro plus shared decision ledger, team vault, and per-seat collaboration.',
        metadata: { tier: 'teams' },
      });
      console.log(`Created Atlas Teams: ${teams.id}`);

      await stripe.prices.create({
        product: teams.id,
        unit_amount: 4900,
        currency: 'usd',
        recurring: { interval: 'month' },
        metadata: { billing: 'monthly', per: 'seat' },
      });
      console.log('Created Teams monthly price: $49/seat/month');
    }

    console.log('\n✓ Done. Webhooks will sync products to the database automatically.');
  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

createProducts();
