import { env } from "../../env.js";
import { decryptString } from "../../lib/crypto.js";
import { processDocument } from "../../lib/ingest/process.js";
import type { ProcessDocumentInput } from "../../lib/ingest/queue.js";

export async function processDocumentActivity(input: ProcessDocumentInput): Promise<void> {
  const password = input.passwordEnc ? decryptString(Buffer.from(input.passwordEnc, "base64"), env.DATA_KEY) : undefined;
  await processDocument(input.documentId, { password, savePassword: input.savePassword });
}
