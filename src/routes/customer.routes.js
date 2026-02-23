import express from "express";
import { prisma } from "../prisma.js";
import { authRequired } from "../auth.js";
import { requireRole } from "../rbac.js";
import { customerCreateSchema } from "../validators.js";
import { audit } from "../audit.js";

export const customerRouter = express.Router();

customerRouter.get("/", authRequired(), async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const customers = await prisma.customer.findMany({
    where: {
      organizationId: req.org.id,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {})
    },
    orderBy: { createdAt: "desc" }
  });
  res.json(customers);
});

customerRouter.post("/", authRequired(), requireRole("SALES"), async (req, res) => {
  const parsed = customerCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.issues });

  const payload = parsed.data;
  const created = await prisma.customer.create({
    data: {
      organizationId: req.org.id,
      name: payload.name,
      email: payload.email || null,
      phone: payload.phone || null,
      tags: payload.tags || []
    }
  });

  await audit(req, { action: "customer.create", entityType: "Customer", entityId: created.id, after: created });
  res.status(201).json(created);
});

customerRouter.put("/:id", authRequired(), requireRole("SALES"), async (req, res) => {
  const parsed = customerCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.issues });

  const id = req.params.id;
  const before = await prisma.customer.findFirst({ where: { id, organizationId: req.org.id } });
  if (!before) return res.status(404).json({ error: "not_found" });

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      tags: parsed.data.tags || []
    }
  });

  await audit(req, { action: "customer.update", entityType: "Customer", entityId: id, before, after: updated });
  res.json(updated);
});

customerRouter.delete("/:id", authRequired(), requireRole("ADMIN"), async (req, res) => {
  const id = req.params.id;
  const before = await prisma.customer.findFirst({ where: { id, organizationId: req.org.id } });
  if (!before) return res.status(404).json({ error: "not_found" });

  const linked = await prisma.invoice.findFirst({ where: { organizationId: req.org.id, customerId: id } });
  if (linked) return res.status(409).json({ error: "customer_linked_invoices" });

  await prisma.customer.delete({ where: { id } });
  await audit(req, { action: "customer.delete", entityType: "Customer", entityId: id, before });
  res.status(204).send();
});
