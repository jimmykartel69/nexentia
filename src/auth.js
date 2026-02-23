import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

const ACCESS_TTL = parseInt(process.env.ACCESS_TTL_SECONDS || "900", 10);
const REFRESH_TTL = parseInt(process.env.REFRESH_TTL_SECONDS || "2592000", 10);

export function signAccess(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefresh(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccess(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}
export function verifyRefresh(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function hashToken(token) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(token, salt);
}

export async function verifyTokenHash(token, hash) {
  return bcrypt.compare(token, hash);
}

export function authRequired() {
  return async (req, res, next) => {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing_token" });

    try {
      const decoded = verifyAccess(token);
      req.user = { id: decoded.sub, email: decoded.email };
      req.org = { id: decoded.orgId, role: decoded.role };
      next();
    } catch {
      return res.status(401).json({ error: "invalid_token" });
    }
  };
}

// Issue tokens for a given membership (org context baked into the access token)
export async function issueTokensForMembership(user, membership) {
  const access = signAccess({
    sub: user.id,
    email: user.email,
    orgId: membership.organizationId,
    role: membership.role
  });

  const refresh = signRefresh({
    sub: user.id,
    orgId: membership.organizationId
  });

  const tokenHash = await hashToken(refresh);
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000);

  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash, expiresAt }
  });

  return { accessToken: access, refreshToken: refresh };
}
