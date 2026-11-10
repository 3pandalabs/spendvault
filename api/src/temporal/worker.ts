import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { documents } from "../db/schema.js";
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
  return stuck.length;
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
