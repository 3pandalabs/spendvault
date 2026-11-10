// Hand a document to the processor: Temporal in prod, in-process when
// PROCESS_INLINE (local dev / no Temporal).
import { env } from "../../env.js";
import { getTemporalClient } from "../../temporal/client.js";
import { temporalEnv } from "../../temporal/env.js";
import { encrypt } from "../crypto.js";
import { errKind, ingestLog } from "./log.js";
import { processDocument, type ProcessOptions } from "./process.js";

export type ProcessDocumentInput = {
  documentId: string;
  // A one-off password crosses Temporal history ONLY encrypted (DATA_KEY, base64).
  passwordEnc?: string;
  savePassword?: boolean;
};

export async function enqueueDocument(documentId: string, opts: ProcessOptions = {}): Promise<void> {
  if (env.PROCESS_INLINE) {
    setImmediate(() => {
      processDocument(documentId, opts).catch((err) => ingestLog.error({ documentId, err: errKind(err) }, "inline processing failed"));
    });
    return;
  }
  const input: ProcessDocumentInput = {
    documentId,
    ...(opts.password ? { passwordEnc: encrypt(opts.password, env.DATA_KEY).toString("base64") } : {}),
    ...(opts.savePassword ? { savePassword: true } : {}),
  };
  const client = await getTemporalClient();
  await client.workflow.start("processDocumentWorkflow", {
    taskQueue: temporalEnv.taskQueue,
    workflowId: `doc-${documentId}`,
    args: [input],
    workflowIdReusePolicy: "ALLOW_DUPLICATE",
    // A retry (e.g. with a password) replaces a run that is still going.
    workflowIdConflictPolicy: "TERMINATE_EXISTING",
  });
}

/** Enqueue, logging instead of throwing: the document row exists and the stuck-doc sweep retries it. */
export async function enqueueSafely(documentId: string, opts: ProcessOptions = {}): Promise<void> {
  try {
    await enqueueDocument(documentId, opts);
  } catch (err) {
    ingestLog.error({ documentId, err: errKind(err) }, "enqueue failed; sweep will retry");
  }
}
