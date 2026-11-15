import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { documents } from "../db/schema.js";
import { env } from "../env.js";
import { enqueueSafely } from "../lib/ingest/queue.js";
import { startInsightsSweep } from "../lib/insights/sweep.js";
import * as activities from "./activities/index.js";
import { temporalEnv } from "./env.js";

// Separate deploy (Dockerfile.worker, Coolify resource `spendvault-worker`):
// runs document processing activities + the insights sweep. Needs the same
// env as the API plus TEMPORAL_*.
//
// The workflow bundler reads workflows/index.{ts,js} off disk; match this
// module's extension so it works under `tsx watch` and as compiled dist/.
const workflowsPath = fileURLToPath(new URL(`./workflows/index${extname(import.meta.url)}`, import.meta.url));

// Stuck documents: a crash between "processing" and the final update, or an
// enqueue that failed after the row was stored. processDocument is
// idempotent, so re-enqueueing is always safe.
const STUCK_SWEEP_MS = 10 * 60_000;

// Receipts parked as pending_extraction (no ANTHROPIC_API_KEY, or the AI call
// failed) are retried hourly once a key is configured.
async function sweepPendingReceipts(): Promise<number> {
  if (!env.ANTHROPIC_API_KEY) return 0;
  const rows = await db
    .update(documents)
    .set({ status: "received", error: null })
    .where(
      inArray(
        documents.id,
        db
          .select({ id: documents.id })
          .from(documents)
          .where(
            and(
              eq(documents.status, "pending_extraction"),
              isNotNull(documents.contentEnc),
              or(isNull(documents.processedAt), lt(documents.processedAt, sql`now() - interval '1 hour'`)),
            ),
          )
          .limit(25),
      ),
    )
    .returning({ id: documents.id });
  for (const d of rows) await enqueueSafely(d.id);
  return rows.length;
}

async function sweepStuckDocuments(): Promise<number> {
  const stuck = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      or(
        and(eq(documents.status, "processing"), lt(documents.createdAt, sql`now() - interval '15 minutes'`)),
        and(eq(documents.status, "received"), lt(documents.createdAt, sql`now() - interval '5 minutes'`)),
      ),
    )
    .limit(200);
  for (const d of stuck) await enqueueSafely(d.id);
  return stuck.length + (await sweepPendingReceipts());
}

function startStuckSweep(): void {
  const tick = () => {
    void sweepStuckDocuments()
      .then((n) => {
        if (n) console.log(`spendvault-worker: re-enqueued ${n} stuck document(s)`);
      })
      .catch((err) => console.error("spendvault-worker: stuck sweep failed", (err as Error).name));
  };
  tick();
  setInterval(tick, STUCK_SWEEP_MS).unref();
}

async function run() {
  startInsightsSweep();
  startStuckSweep();
  const connection = await NativeConnection.connect({ address: temporalEnv.address });
  try {
    const worker = await Worker.create({
      connection,
      namespace: temporalEnv.namespace,
      taskQueue: temporalEnv.taskQueue,
      workflowsPath,
      activities,
    });
    console.log(`spendvault-worker: polling task queue "${temporalEnv.taskQueue}" at ${temporalEnv.address}`);
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
