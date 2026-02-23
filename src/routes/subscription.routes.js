import express from "express";
import { prisma } from "../prisma.js";
import { authRequired } from "../auth.js";
import { requireRole } from "../rbac.js";
import { audit } from "../audit.js";

export const subscriptionRouter = express.Router();

subscriptionRouter.get("/", authRequired(), async (req, res) => {
  const sub = await prisma.subscription.findUnique({ where: { organizationId: req.org.id } });
  res.json(sub);
});

// V0: change plan manually (owner only). In production: Stripe webhook updates this.
subscriptionRouter.post("/set-plan", authRequired(), requireRole("OWNER"), async (req, res) => {
  const plan = req.body?.plan;
  if (!["CLASSIC", "PRO", "ENTERPRISE"].includes(plan)) return res.status(400).json({ error: "invalid_plan" });

  const before = await prisma.subscription.findUnique({ where: { organizationId: req.org.id } });
  const updated = await prisma.subscription.update({
    where: { organizationId: req.org.id },
    data: { plan, status: "active" }
  });

  await audit(req, { action: "subscription.set_plan", entityType: "Subscription", entityId: updated.id, before, after: updated });
  res.json(updated);
});
