import { proxyActivities } from "@temporalio/workflow";
import type * as acts from "../activities/index.js";

// One short workflow per document run (id `doc-<documentId>`): Temporal owns
// retries, Postgres owns state. The input never carries a plaintext password
// (passwordEnc is DATA_KEY-encrypted, decrypted inside the activity).
export type ProcessDocumentInput = { documentId: string; passwordEnc?: string; savePassword?: boolean };

const { processDocumentActivity } = proxyActivities<typeof acts>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "10 seconds", backoffCoefficient: 3 },
});

export async function processDocumentWorkflow(input: ProcessDocumentInput): Promise<void> {
  await processDocumentActivity(input);
}
