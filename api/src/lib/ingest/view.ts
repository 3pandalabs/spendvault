import type { documents } from "../../db/schema.js";
import { institutionName } from "../institutions.js";
import { toNum } from "../money.js";

type DocRow = typeof documents.$inferSelect;

/** The `Document` shape from ROUTES.md. */
export function documentView(d: DocRow) {
  return {
    id: d.id,
    source: d.source,
    kind: d.kind as "statement" | "alert" | "unknown",
    status: d.status,
    filename: d.filename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    emailFrom: d.emailFrom,
    emailSubject: d.emailSubject,
    institution: d.institution,
    institutionName: institutionName(d.institution),
    accountId: d.accountId,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    statementTotal: toNum(d.statementTotal),
    extractedDebits: toNum(d.extractedDebits),
    reconciled: d.reconciled,
    txnCount: d.txnCount,
    parser: d.parser,
    error: d.error,
    hasOriginal: d.contentEnc !== null,
    processedAt: d.processedAt ? d.processedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  };
}

export type DocumentView = ReturnType<typeof documentView>;
