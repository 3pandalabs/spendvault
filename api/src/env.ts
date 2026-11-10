import "dotenv/config";
import { z } from "zod";

// Validated once at import. Every process that touches the database (API,
// Temporal worker) loads this; pure modules (parsers, insights, categories)
// deliberately do not, so unit tests run without any environment.
const optional = z.string().optional().default("");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars (openssl rand -hex 32)"),

  // 32-byte hex key (openssl rand -hex 32). Encrypts stored PDF passwords and
  // raw documents at rest (AES-256-GCM, lib/crypto.ts). Losing it makes saved
  // passwords and unparsed documents unreadable; parsed transactions are fine.
  DATA_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "DATA_KEY must be 64 hex chars (openssl rand -hex 32)"),

  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: optional,

  // Forwarding addresses are `<inbound_token>@<INBOUND_DOMAIN>`.
  INBOUND_DOMAIN: z.string().default("in.spendvault.3pandalabs.com"),

  // Shared with the web Worker and the inbound-email Worker (X-Internal-Secret).
  // Required for /internal/* routes; unset → those routes answer 503.
  INTERNAL_SHARED_SECRET: optional,

  // Claude extraction/categorization. Optional: unset → rules-only parsing.
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default("claude-haiku-5-5"),

  // WhatsApp Cloud API (Meta). All optional: unset → the webhook answers 503
  // and the settings page shows WhatsApp as "not available yet".
  WHATSAPP_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_DISPLAY_NUMBER: optional,
  WHATSAPP_API_URL: z.string().default("https://graph.facebook.com/v21.0"),

  // Process documents in the API process instead of via Temporal (local dev,
  // or a box without Temporal). Prod leaves this false.
  PROCESS_INLINE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  METRICS_TOKEN: optional,

  MAILER_URL: optional,
  MAILER_TOKEN: optional,
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  EMAIL_FROM_NAME: z.string().default("SpendVault"),

  GIT_COMMIT: optional,
  SOURCE_COMMIT: optional,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid environment: ${issues}`);
}

const e = parsed.data;

export const env = {
  ...e,
  CORS_ORIGINS: [e.WEB_ORIGIN, ...e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)],
  GIT_COMMIT: e.SOURCE_COMMIT || e.GIT_COMMIT || "unknown",
};
