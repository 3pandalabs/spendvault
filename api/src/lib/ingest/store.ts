// Storing incoming documents (encrypted, per-user sha256 dedupe) and splitting
// raw emails into documents. DB-bound.
import { and, eq } from "drizzle-orm";
import { simpleParser, type ParsedMail } from "mailparser";
import { db } from "../../db/index.js";
import { documents, forwardingConfirmations, receipts, users, type DocumentSource } from "../../db/schema.js";
import { env } from "../../env.js";
import { encrypt, sha256Hex } from "../crypto.js";
import { institutionFromSender, institutionFromText } from "../institutions.js";
import { looksLikeReceipt, looksLikeReceiptSubject, MIN_RECEIPT_IMAGE_BYTES } from "../receipts/detect.js";
import { looksLikeAlert } from "./alert.js";
import { detectForwardingConfirmation, fileTypeOf, isStatementAttachment, mimeFor } from "./classify.js";

export type DocRow = typeof documents.$inferSelect;

export type NewDocument = {
  userId: string;
  source: DocumentSource;
  kind: "statement" | "alert" | "receipt" | "unknown";
  content: Buffer;
  mimeType: string;
  filename?: string | null;
  emailFrom?: string | null;
  emailSubject?: string | null;
  whatsappFrom?: string | null;
  institution?: string | null;
};

/** Insert (or find the existing duplicate of) a document. `created` = false for a duplicate. */
export async function storeDocument(d: NewDocument): Promise<{ doc: DocRow; created: boolean }> {
  const sha256 = sha256Hex(d.content);
  const [row] = await db
    .insert(documents)
    .values({
      userId: d.userId,
      source: d.source,
      kind: d.kind,
      status: "received",
      filename: d.filename?.slice(0, 255) ?? null,
      mimeType: d.mimeType,
      contentEnc: encrypt(d.content, env.DATA_KEY),
      sha256,
      sizeBytes: d.content.length,
      emailFrom: d.emailFrom?.slice(0, 320) ?? null,
      emailSubject: d.emailSubject?.slice(0, 500) ?? null,
      whatsappFrom: d.whatsappFrom ?? null,
      institution: d.institution ?? null,
    })
    .onConflictDoNothing({ target: [documents.userId, documents.sha256] })
    .returning();
  if (row) {
    // Receipts get their row right away so the Receipts list shows them while processing.
    if (row.kind === "receipt") {
      const [u] = await db.select({ c: users.baseCurrency }).from(users).where(eq(users.id, d.userId)).limit(1);
      await db.insert(receipts).values({ userId: d.userId, documentId: row.id, currency: u?.c ?? "INR" }).onConflictDoNothing({ target: receipts.documentId });
    }
    return { doc: row, created: true };
  }
  const [existing] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, d.userId), eq(documents.sha256, sha256)))
    .limit(1);
  return { doc: existing, created: false };
}

export type EmailIngestResult = {
  docs: Array<{ doc: DocRow; created: boolean }>;
  ignored: "forwarding_confirmation" | "not_financial" | null;
};

/** The alert text we store: subject + plain body + the mail's date (fallback when the body has none). */
export function alertTextOf(mail: Pick<ParsedMail, "subject" | "text" | "date">): string {
  const body = (mail.text ?? "").replace(/\r/g, "").trim();
  const date = (mail.date ?? new Date()).toISOString().slice(0, 10);
  return `${mail.subject ?? ""}\n\n${body}\n\n[email-date: ${date}]`;
}

/** Split one raw RFC822 message into documents for `userId`. */
export async function ingestEmail(userId: string, raw: Buffer, source: DocumentSource = "email"): Promise<EmailIngestResult> {
  const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  const from = mail.from?.value[0]?.address ?? null;
  const subject = mail.subject ?? null;

  const conf = detectForwardingConfirmation(from, subject, mail.text ?? null);
  if (conf) {
    await db.insert(forwardingConfirmations).values({ userId, ...conf });
    return { docs: [], ignored: "forwarding_confirmation" };
  }

  const senderInst = institutionFromSender(from) ?? institutionFromText(subject);
  const docs: EmailIngestResult["docs"] = [];
  // A merchant's order/payment mail (not from a bank) carrying an invoice PDF.
  const receiptMail = !senderInst && looksLikeReceiptSubject(subject);
  for (const att of mail.attachments ?? []) {
    const type = fileTypeOf(att.contentType, att.filename, att.content.subarray(0, 8));
    if (!type) continue;
    // Photographed / scanned receipts attached to a mail (logos and inline images are skipped).
    const isReceiptImage = type === "image" && att.contentDisposition !== "inline" && att.content.length >= MIN_RECEIPT_IMAGE_BYTES;
    if (!isReceiptImage && !isStatementAttachment(att.contentType, att.filename)) continue;
    const inst = senderInst ?? institutionFromText(att.filename);
    docs.push(
      await storeDocument({
        userId,
        source,
        kind: isReceiptImage || (receiptMail && type === "pdf") ? "receipt" : "statement",
        content: att.content,
        mimeType: mimeFor(type, att.contentType),
        filename: att.filename ?? null,
        emailFrom: from,
        emailSubject: subject,
        institution: inst?.key ?? null,
      }),
    );
  }
  if (docs.length) return { docs, ignored: null };

  const text = alertTextOf(mail);
  // An e-receipt in the body (order confirmation, e-bill) from a non-bank sender.
  if (!senderInst && looksLikeReceipt(text)) {
    docs.push(
      await storeDocument({
        userId,
        source,
        kind: "receipt",
        content: Buffer.from(text, "utf8"),
        mimeType: "text/plain",
        filename: null,
        emailFrom: from,
        emailSubject: subject,
        institution: null,
      }),
    );
    return { docs, ignored: null };
  }
  if (!looksLikeAlert(text)) return { docs: [], ignored: "not_financial" };
  docs.push(
    await storeDocument({
      userId,
      source,
      kind: "alert",
      content: Buffer.from(text, "utf8"),
      mimeType: "text/plain",
      filename: null,
      emailFrom: from,
      emailSubject: subject,
      institution: senderInst?.key ?? institutionFromText(text.slice(0, 2000))?.key ?? null,
    }),
  );
  return { docs, ignored: null };
}
