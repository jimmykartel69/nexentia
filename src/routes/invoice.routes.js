import express from "express";
import { prisma } from "../prisma.js";
import { authRequired } from "../auth.js";
import { requireRole } from "../rbac.js";
import { invoiceCreateSchema } from "../validators.js";
import { audit } from "../audit.js";

export const invoiceRouter = express.Router();

invoiceRouter.get("/", authRequired(), async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.org.id },
    orderBy: { date: "desc" },
    include: { customer: true }
  });
  res.json(invoices.map((i) => ({
    ...i,
    customerName: i.customer?.name || "—"
  })));
});

invoiceRouter.post("/", authRequired(), requireRole("FINANCE"), async (req, res) => {
  const parsed = invoiceCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.issues });

  const cust = await prisma.customer.findFirst({
    where: { id: parsed.data.customerId, organizationId: req.org.id }
  });
  if (!cust) return res.status(404).json({ error: "customer_not_found" });

  try {
    const created = await prisma.invoice.create({
      data: {
        organizationId: req.org.id,
        customerId: parsed.data.customerId,
        number: parsed.data.number,
        date: new Date(parsed.data.date),
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        totalCents: parsed.data.totalCents,
        currency: parsed.data.currency || "EUR",
        status: parsed.data.status || "SENT"
      }
    });

    await audit(req, { action: "invoice.create", entityType: "Invoice", entityId: created.id, after: created });
    res.status(201).json(created);
  } catch {
    return res.status(409).json({ error: "invoice_number_conflict" });
  }
});

invoiceRouter.put("/:id", authRequired(), requireRole("FINANCE"), async (req, res) => {
  const id = req.params.id;

  const before = await prisma.invoice.findFirst({ where: { id, organizationId: req.org.id } });
  if (!before) return res.status(404).json({ error: "not_found" });

  const parsed = invoiceCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.issues });

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      customerId: parsed.data.customerId,
      number: before.number, // lock number on update
      date: new Date(parsed.data.date),
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      totalCents: parsed.data.totalCents,
      currency: parsed.data.currency || "EUR",
      status: parsed.data.status || before.status
    }
  });

  await audit(req, { action: "invoice.update", entityType: "Invoice", entityId: id, before, after: updated });
  res.json(updated);
});

invoiceRouter.post("/:id/mark-paid", authRequired(), requireRole("FINANCE"), async (req, res) => {
  const id = req.params.id;
  const before = await prisma.invoice.findFirst({ where: { id, organizationId: req.org.id } });
  if (!before) return res.status(404).json({ error: "not_found" });

  const updated = await prisma.invoice.update({
    where: { id },
    data: { status: "PAID" }
  });

  await audit(req, { action: "invoice.mark_paid", entityType: "Invoice", entityId: id, before, after: updated });
  res.json(updated);
});

invoiceRouter.delete("/:id", authRequired(), requireRole("ADMIN"), async (req, res) => {
  const id = req.params.id;
  const before = await prisma.invoice.findFirst({ where: { id, organizationId: req.org.id } });
  if (!before) return res.status(404).json({ error: "not_found" });

  await prisma.invoice.delete({ where: { id } });
  await audit(req, { action: "invoice.delete", entityType: "Invoice", entityId: id, before });
  res.status(204).send();
});
