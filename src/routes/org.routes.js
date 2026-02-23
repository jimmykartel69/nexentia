import express from "express";
import { prisma } from "../prisma.js";
import { authRequired } from "../auth.js";

export const orgRouter = express.Router();

orgRouter.get("/me", authRequired(), async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.org.id } });
  const sub = await prisma.subscription.findUnique({ where: { organizationId: req.org.id } });
  return res.json({
    user: req.user,
    org: { id: org.id, name: org.name },
    role: req.org.role,
    subscription: sub
  });
});

orgRouter.get("/memberships", authRequired(), async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.user.id },
    include: { organization: true }
  });
  return res.json(memberships.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    role: m.role
  })));
});
