import express from "express";
import { stripe } from "../stripe.js";
import { prisma } from "../prisma.js";

export const stripeWebhookRouter = express.Router();

stripeWebhookRouter.post("/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe webhook] signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        const orgId = session?.metadata?.organizationId;
        const stripeSubId = session.subscription;
        const stripeCustomerId = session.customer;

        if (!orgId || !stripeSubId) break;

        const sub = await stripe.subscriptions.retrieve(stripeSubId, {
          expand: ["items.data.price.product"],
        });

        const item = sub.items.data[0];
        const priceId = item?.price?.id || null;
        const productId = item?.price?.product?.id || null;

        const plan = inferPlan(priceId);

        await prisma.subscription.upsert({
          where: { organizationId: orgId },
          create: {
            organizationId: orgId,
            plan: plan || "CLASSIC",
            status: sub.status,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            stripeCustomerId,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            stripeProductId: productId,
          },
          update: {
            plan: plan || undefined,
            status: sub.status,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            stripeCustomerId,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            stripeProductId: productId,
          },
        });

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const orgId = sub?.metadata?.organizationId;
        if (!orgId) break;

        const item = sub.items?.data?.[0];
        const priceId = item?.price?.id || null;
        const plan = inferPlan(priceId);

        await prisma.subscription.update({
          where: { organizationId: orgId },
          data: {
            plan: plan || undefined,
            status: sub.status,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            stripeCustomerId: sub.customer,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
          },
        });

        break;
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("[stripe webhook] handler failed:", e);
    return res.status(500).json({ error: "webhook_handler_failed" });
  }
});

function inferPlan(priceId) {
  if (priceId === "price_1T47tOGOadShEPZdnXK5If9R") return "CLASSIC";
  if (priceId === "price_1T47tkGOadShEPZd8CGlZFEU") return "PRO";
  if (priceId === "price_1T47uTGOadShEPZdqQhd4b6B") return "ENTERPRISE";
  return null;
}