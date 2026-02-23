import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { authRouter } from "./routes/auth.routes.js";
import { orgRouter } from "./routes/org.routes.js";
import { customerRouter } from "./routes/customer.routes.js";
import { invoiceRouter } from "./routes/invoice.routes.js";
import { subscriptionRouter } from "./routes/subscription.routes.js";
import { stripeWebhookRouter } from "./routes/stripe.webhook.js";
import { billingRouter } from "./routes/billing.routes.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/webhooks/")) {
    return next();
  }
  return express.json({ limit: "1mb" })(req, res, next);
});

app.get("/health", (_, res) => res.json({ ok: true, app: "NEXENTIA" }));

app.use("/auth", authRouter);
app.use("/org", orgRouter);
app.use("/customers", customerRouter);
app.use("/invoices", invoiceRouter);
app.use("/subscription", subscriptionRouter);
app.use("/billing", billingRouter);
// ✅ webhook AVANT json
app.use("/webhooks", express.raw({ type: "application/json" }), stripeWebhookRouter);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`NEXENTIA API listening on http://localhost:${port}`));
