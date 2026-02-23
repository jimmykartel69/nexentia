import express from "express";
import { prisma } from "../prisma.js";
import { signupSchema, loginSchema } from "../validators.js";
import {
  hashPassword,
  verifyPassword,
  issueTokensForMembership,
  verifyRefresh,
  verifyTokenHash,
  signAccess,
  hashToken
} from "../auth.js";
import { audit } from "../audit.js";

export const authRouter = express.Router();

const REFRESH_TTL = parseInt(process.env.REFRESH_TTL_SECONDS || "2592000", 10);

authRouter.post("/signup", async (req, res) => {
  if (process.env.ALLOW_PUBLIC_SIGNUP !== "true") {
    return res.status(403).json({ error: "signup_disabled" });
  }

  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.issues });

  const { email, password, orgName } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: "email_taken" });

  const passwordHash = await hashPassword(password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash } });
    const org = await tx.organization.create({ data: { name: orgName } });
    const membership = await tx.membership.create({
      data: { userId: user.id, organizationId: org.id, role: "OWNER" }
    });
    await tx.subscription.create({
      data: {
        organizationId: org.id,
        plan: "CLASSIC",
        status: "trialing",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 14 * 24 * 3600 * 1000)
      }
    });
    return { user, org, membership };
  });

  // attach pseudo context for audit
  req.user = { id: created.user.id, email: created.user.email };
  req.org = { id: created.org.id, role: created.membership.role };
  await audit(req, { action: "auth.signup", entityType: "Organization", entityId: created.org.id });

  const tokens = await issueTokensForMembership(created.user, created.membership);
  return res.json({
    organization: { id: created.org.id, name: created.org.name },
    role: created.membership.role,
    ...tokens
  });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.issues });

  const { email, password, orgId } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  let membership = null;
  if (orgId) membership = user.memberships.find((m) => m.organizationId === orgId);
  if (!membership) membership = user.memberships[0];
  if (!membership) return res.status(403).json({ error: "no_membership" });

  req.user = { id: user.id, email: user.email };
  req.org = { id: membership.organizationId, role: membership.role };
  await audit(req, { action: "auth.login" });

  const tokens = await issueTokensForMembership(user, membership);
  return res.json({
    organizationId: membership.organizationId,
    role: membership.role,
    ...tokens
  });
});

authRouter.post("/refresh", async (req, res) => {
  const token = req.body?.refreshToken;
  if (!token) return res.status(400).json({ error: "missing_refresh" });

  let decoded;
  try {
    decoded = verifyRefresh(token);
  } catch {
    return res.status(401).json({ error: "invalid_refresh" });
  }

  const userId = decoded.sub;
  const orgId = decoded.orgId;

  const stored = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  let match = false;
  for (const t of stored) {
    // eslint-disable-next-line no-await-in-loop
    if (await verifyTokenHash(token, t.tokenHash)) { match = true; break; }
  }
  if (!match) return res.status(401).json({ error: "refresh_not_recognized" });

  const membership = await prisma.membership.findFirst({ where: { userId, organizationId: orgId } });
  if (!membership) return res.status(403).json({ error: "no_membership" });

  const user = await prisma.user.findUnique({ where: { id: userId } });

  // new access + rotate refresh (DEMO rotation; in prod use jti + crypto randomness + revocation strategy)
  const accessToken = signAccess({ sub: user.id, email: user.email, orgId, role: membership.role });

  const newRefresh = rotateToken(token);
  const tokenHash = await hashToken(newRefresh);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + REFRESH_TTL * 1000) }
  });

  return res.json({ accessToken, refreshToken: newRefresh });
});

function rotateToken(oldToken) {
  return oldToken.split("").reverse().join("") + "." + Math.random().toString(16).slice(2);
}
