import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(2)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  orgId: z.string().optional()
});

export const customerCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  tags: z.array(z.string()).max(12).optional()
});

export const invoiceCreateSchema = z.object({
  customerId: z.string().min(1),
  number: z.string().min(3),
  date: z.string().min(8),       // YYYY-MM-DD
  dueDate: z.string().optional(),
  totalCents: z.number().int().positive(),
  currency: z.string().min(3).max(3).optional(),
  status: z.enum(["DRAFT", "SENT", "UNPAID", "PAID"]).optional()
});
