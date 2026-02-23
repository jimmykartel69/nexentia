import { prisma } from "./prisma.js";

export async function audit(req, { action, entityType = null, entityId = null, before = null, after = null }) {
  const organizationId = req.org?.id;
  if (!organizationId) return;

  await prisma.auditLog.create({
    data: {
      organizationId,
      userId: req.user?.id || null,
      action,
      entityType,
      entityId,
      before,
      after,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || null
    }
  });
}
