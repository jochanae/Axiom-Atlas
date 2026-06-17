import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import shellRouter from "./routes/shell";
import { logger } from "./lib/logger";
import { WebhookHandlers } from "./webhookHandlers";

const app: Express = express();

// ── Stripe webhook — MUST be registered before express.json() ──────────────
// Stripe sends raw Buffer; express.json() would destroy it
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature' });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error({ err }, 'Stripe webhook error');
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

// ── Standard middleware ────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
const ALLOWED_ORIGINS: Set<string> = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
  "https://axiomsystem.app",
  "https://www.axiomsystem.app",
  "https://axiom-atlas-mocha.vercel.app",
  "https://lovable.dev",
  "https://5360bfd7-938b-4b5e-b3a5-5d9c9f8e7a2b.lovableproject.com",
  "https://atlas-idk.vercel.app",
  "https://atlas-iq.lovable.app",
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
  ...(process.env.REPLIT_DOMAINS?.split(",").map((d) => `https://${d.trim()}`) ?? []),
  ...(process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : []),
  ...(process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
  ...(process.env.EXTRA_ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      if (/^https:\/\/[^.]+\.replit\.(dev|app)$/.test(origin)) return callback(null, true);
      if (/^https:\/\/([a-z0-9-]+\.)*lovable\.app$/.test(origin)) return callback(null, true);
      if (/^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/.test(origin)) return callback(null, true);
      if (/^https:\/\/([a-z0-9-]+\.)*vercel\.app$/.test(origin)) return callback(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-GitHub-Token", "X-Requested-With"],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
// Fallback: some clients (Lovable preview, certain fetch polyfills) omit the
// Content-Type header. express.json() silently skips those — body stays
// undefined. express.text('*/*') reads whatever body-parser left unread, then
// the inline middleware tries to JSON-parse it. This makes every POST/PUT/PATCH
// resilient regardless of whether the client sent a Content-Type header.
app.use(express.text({ limit: "20mb", type: "*/*" }));
app.use((req, _res, next) => {
  if (typeof req.body === "string") {
    const trimmed = req.body.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // leave as string — let the route validator produce the right error
      }
    }
  }
  next();
});
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/shell", shellRouter);
app.use("/api", router);

export default app;
