import express from "express";
import { prisma } from "../prisma.js";
import { stripe } from "../stripe.js";
import { authRequired } from "../auth.js";

export const billingRouter = express.Router();

/**
 * POST /billing/checkout
 * body: { priceId }
 * returns: { url }
 */
billingRouter.post("/checkout", authRequired(), async (req, res) => {
    try {
      const priceId = req.body?.priceId;
      if (!priceId) return res.status(400).json({ error: "missing_priceId" });
  
      const orgId = req.org.id;
  
      const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
      if (!sub) return res.status(404).json({ error: "subscription_missing" });
  
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ error: "stripe_secret_missing" });
      }
      if (!process.env.APP_URL) {
        return res.status(500).json({ error: "app_url_missing" });
      }
  
      let customerId = sub.stripeCustomerId;
  
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { organizationId: orgId },
        });
        customerId = customer.id;
  
        await prisma.subscription.update({
          where: { organizationId: orgId },
          data: { stripeCustomerId: customerId },
        });
      }
  
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.APP_URL}/app?checkout=success`,
        cancel_url: `${process.env.APP_URL}/app?checkout=cancel`,
        subscription_data: {
          metadata: { organizationId: orgId },
        },
        metadata: { organizationId: orgId, priceId },
      });
  
      return res.json({ url: session.url });
    } catch (e) {
      console.error("[billing/checkout] failed:", e);
      return res.status(500).json({ error: "checkout_failed", message: String(e?.message || e) });
    }
  });

/**
 * POST /billing/portal
 * returns: { url }
 */
billingRouter.post("/portal", authRequired(), async (req, res) => {
  const orgId = req.org.id;
  const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
  if (!sub?.stripeCustomerId) return res.status(400).json({ error: "missing_stripe_customer" });

  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${process.env.APP_URL}/app`,
  });

  res.json({ url: portal.url });
});