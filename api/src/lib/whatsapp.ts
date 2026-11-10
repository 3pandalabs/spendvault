import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

// WhatsApp Cloud API (Meta), after AdVault's lib/whatsapp. Every reply we
// send is inside the 24-hour window the user's own message opened (they just
// sent us a code, a PDF or a password), so plain text is allowed; no templates.

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_APP_SECRET);
}

export class WhatsAppNotConfigured extends Error {
  constructor() {
    super("whatsapp_not_configured");
  }
}

const graph = () => env.WHATSAPP_API_URL.replace(/\/$/, "");

export async function sendText(to: string, body: string): Promise<void> {
  if (!isWhatsAppConfigured()) throw new WhatsAppNotConfigured();
  const res = await fetch(`${graph()}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`whatsapp send failed: ${res.status}`);
}

/** Fire-and-forget reply; failures are logged by the caller's `log`, never thrown. */
export async function replySafely(to: string, body: string, log: (msg: string) => void): Promise<void> {
  if (!isWhatsAppConfigured()) return;
  try {
    await sendText(to, body);
  } catch (err) {
    log(`whatsapp reply failed: ${(err as Error).message.slice(0, 80)}`);
  }
}

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/** Media download: GET /{media-id} → { url, mime_type }, then GET url with the bearer token. */
export async function downloadMedia(mediaId: string): Promise<{ content: Buffer; mimeType: string }> {
  if (!isWhatsAppConfigured()) throw new WhatsAppNotConfigured();
  const auth = { authorization: `Bearer ${env.WHATSAPP_TOKEN}` };
  const meta = await fetch(`${graph()}/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(10_000) });
  if (!meta.ok) throw new Error(`whatsapp media lookup failed: ${meta.status}`);
  const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!info.url) throw new Error("whatsapp media lookup: no url");
  if (info.file_size && info.file_size > MAX_MEDIA_BYTES) throw new Error("whatsapp media too large");
  const res = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`whatsapp media download failed: ${res.status}`);
  const content = Buffer.from(await res.arrayBuffer());
  if (content.length > MAX_MEDIA_BYTES) throw new Error("whatsapp media too large");
  return { content, mimeType: info.mime_type ?? "application/octet-stream" };
}

/** Meta's subscribe handshake. Returns the challenge to echo, or null. */
export function verifyChallenge(query: Record<string, unknown>): string | null {
  const mode = String(query["hub.mode"] ?? "");
  const token = String(query["hub.verify_token"] ?? "");
  const challenge = String(query["hub.challenge"] ?? "");
  if (mode !== "subscribe" || !env.WHATSAPP_VERIFY_TOKEN) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(env.WHATSAPP_VERIFY_TOKEN);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return challenge;
}

/** X-Hub-Signature-256 over the RAW body bytes. */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !env.WHATSAPP_APP_SECRET) return false;
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type InboundMessage =
  | { kind: "text"; id: string; from: string; body: string }
  | { kind: "media"; id: string; from: string; mediaId: string; mimeType: string | null; filename: string | null; media: "document" | "image" };

type WebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          document?: { id?: string; mime_type?: string; filename?: string };
          image?: { id?: string; mime_type?: string };
        }>;
      };
    }>;
  }>;
};

/** Text, document and image messages from a verified webhook body. Everything else is dropped. */
export function parseInbound(rawBody: Buffer | string): InboundMessage[] {
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")) as WebhookPayload;
  } catch {
    return [];
  }
  const out: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (!msg.id || !msg.from) continue;
        const from = msg.from.replace(/\D/g, "");
        if (msg.type === "text") out.push({ kind: "text", id: msg.id, from, body: msg.text?.body ?? "" });
        else if (msg.type === "document" && msg.document?.id)
          out.push({ kind: "media", media: "document", id: msg.id, from, mediaId: msg.document.id, mimeType: msg.document.mime_type ?? null, filename: msg.document.filename ?? null });
        else if (msg.type === "image" && msg.image?.id)
          out.push({ kind: "media", media: "image", id: msg.id, from, mediaId: msg.image.id, mimeType: msg.image.mime_type ?? null, filename: null });
      }
    }
  }
  return out;
}
