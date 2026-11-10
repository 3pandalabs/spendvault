import cors from "@fastify/cors";
import Fastify, { type FastifyError } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { authPlugin } from "./auth/plugin.js";
import { env } from "./env.js";
import { DomainError } from "./lib/errors.js";
import { loggerOptions } from "./lib/logRedact.js";
import { recordRequest, startCpuSampler } from "./metrics/collector.js";
import { authRoutes } from "./routes/auth.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { documentRoutes } from "./routes/documents.js";
import { internalRoutes } from "./routes/internal.js";
import { meRoutes } from "./routes/me.js";
import { metricsRoutes } from "./routes/metrics.js";
import { transactionRoutes } from "./routes/transactions.js";
import { whatsappRoutes } from "./routes/whatsapp.js";

const app = Fastify({
  logger: loggerOptions,
  trustProxy: true,
  // Raw inbound emails can carry statement attachments (Email Routing max 25 MB).
  bodyLimit: 26 * 1024 * 1024,
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] });
await app.register(authPlugin);

const startedAt = new Date().toISOString();
app.get("/health", async () => ({ ok: true, commit: env.GIT_COMMIT, startedAt }));

startCpuSampler();
app.addHook("onResponse", async (req) => {
  if (req.url !== "/metrics" && req.url !== "/health") recordRequest();
});

app.setErrorHandler((err: FastifyError & { code?: string; publicCode?: string }, req, reply) => {
  if (err instanceof DomainError) {
    return reply.code(err.status).send({ error: err.message, code: err.code });
  }
  if (err.validation) {
    return reply.code(400).send({ error: err.message || "invalid_request", code: "VALIDATION" });
  }
  if (err.publicCode) {
    return reply.code(err.statusCode ?? 429).send({ error: err.publicCode });
  }
  if (err.code === "23505") return reply.code(409).send({ error: "conflict", code: "CONFLICT" });
  if (err.code === "23514") return reply.code(400).send({ error: "invalid_request", code: "VALIDATION" });
  const status = err.statusCode ?? 500;
  if (status < 500) return reply.code(status).send({ error: err.code ?? "bad_request" });
  req.log.error(err);
  return reply.code(status).send({ error: "internal_error" });
});

await app.register(authRoutes);
await app.register(meRoutes);
await app.register(documentRoutes);
await app.register(transactionRoutes);
await app.register(dashboardRoutes);
await app.register(whatsappRoutes);
await app.register(internalRoutes);
await app.register(metricsRoutes);

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
