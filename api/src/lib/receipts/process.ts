// Receipt branch of processDocument: extract with Claude (vision / PDF / text)
// when ANTHROPIC_API_KEY is set, otherwise keep the encrypted original and mark
// the receipt pending_extraction (the worker retries those once a key exists;
// the user can type the total meanwhile). Never fabricates parse results.
// DB-bound; logs ids and counts only.
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { documents, receipts, users } from "../../db/schema.js";
import type { FileType } from "../ingest/classify.js";
import type { LlmClient } from "../ingest/llm.js";
import { errKind, ingestLog } from "../ingest/log.js";
import { ensureReceipt, matchReceipt, saveExtraction } from "./db.js";
import { extractReceiptWithLlm, type ReceiptInput } from "./llm.js";

type DocRow = typeof documents.$inferSelect;
type UserRow = typeof users.$inferSelect;

export type ReceiptOutcome = "done" | "not_receipt";

/** Text shorter than this from a PDF means a scan: send the PDF itself. */
const MIN_PDF_TEXT = 40;

function llmInput(doc: DocRow, buf: Buffer, type: FileType, text?: string): ReceiptInput | null {
  if (type === "image") {
    const mediaType = (["image/png", "image/webp"].includes(doc.mimeType) ? doc.mimeType : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";
    return { image: { mediaType, data: buf } };
  }
  if (type === "pdf") return text && text.replace(/\s+/g, "").length >= MIN_PDF_TEXT ? { text } : { pdf: buf };
  if (type === "text") return { text: text ?? buf.toString("utf8") };
  return null;
}

/** A receipt the user typed in stays "manual": put its document back to parsed. */
async function keepManual(doc: DocRow) {
  await db.update(documents).set({ kind: "receipt", status: "parsed", error: null }).where(eq(documents.id, doc.id));
}

async function markPending(doc: DocRow, receiptId: string, error: string | null) {
  await db.transaction(async (tx) => {
    await tx.update(receipts).set({ status: "pending_extraction", error, updatedAt: new Date() }).where(eq(receipts.id, receiptId));
    await tx
      .update(documents)
      .set({ kind: "receipt", status: "pending_extraction", error, processedAt: new Date() })
      .where(eq(documents.id, doc.id));
  });
}

export async function processReceipt(
  doc: DocRow,
  buf: Buffer,
  user: UserRow,
  client: LlmClient | null,
  model: string,
  src: { type: FileType; text?: string },
): Promise<ReceiptOutcome> {
  const input = llmInput(doc, buf, src.type, src.text);
  if (!input) return "not_receipt";
  const receipt = await ensureReceipt(db, doc, user.baseCurrency);
  // A receipt the user already typed in stays as typed unless AI can now read it.
  if (!client) {
    if (receipt.status === "manual") await keepManual(doc);
    else await markPending(doc, receipt.id, null);
    ingestLog.info({ documentId: doc.id, receiptId: receipt.id }, "receipt stored, pending extraction");
    return "done";
  }

  let ex;
  try {
    ex = await extractReceiptWithLlm(client, model, { ...input, fallbackCurrency: user.baseCurrency });
  } catch (err) {
    ingestLog.warn({ documentId: doc.id, err: errKind(err) }, "receipt extraction failed");
    if (receipt.status === "manual") await keepManual(doc);
    else await markPending(doc, receipt.id, "AI reading failed. Enter the total, or retry later.");
    return "done";
  }

  if (!ex.isReceipt) {
    await db.delete(receipts).where(eq(receipts.id, receipt.id));
    if (src.type === "image" || src.type === "pdf") {
      // Probably a statement photo/scan: let the statement path have it.
      await db.update(documents).set({ kind: "statement" }).where(eq(documents.id, doc.id));
      doc.kind = "statement";
      return "not_receipt";
    }
    await db.update(documents).set({ status: "ignored", error: "not a receipt", processedAt: new Date() }).where(eq(documents.id, doc.id));
    return "done";
  }

  const ok = ex.total !== null;
  await db.transaction(async (tx) => {
    await saveExtraction(tx, receipt, ex);
    await tx
      .update(documents)
      .set({
        kind: "receipt",
        status: ok ? "parsed" : "failed",
        error: ok ? null : "Couldn't read the total",
        parser: "llm:receipt",
        txnCount: 0,
        processedAt: new Date(),
        // Same retention rule as statements: originals go after a successful read.
        ...(ok && user.deleteOriginals ? { contentEnc: null } : {}),
      })
      .where(eq(documents.id, doc.id));
  });
  ingestLog.info({ documentId: doc.id, receiptId: receipt.id, items: ex.items.length, reconciled: ex.itemsReconciled ?? "n/a" }, "receipt extracted");
  if (ok) {
    try {
      await matchReceipt(doc.userId, receipt.id);
    } catch (err) {
      ingestLog.warn({ receiptId: receipt.id, err: errKind(err) }, "receipt match failed");
    }
  }
  return "done";
}
