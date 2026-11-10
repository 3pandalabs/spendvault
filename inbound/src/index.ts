// spendvault-inbound: receives every mail sent to *@in.spendvault.3pandalabs.com
// (Cloudflare Email Routing catch-all → this Worker) and hands the raw message
// to the API, which finds the user by the local part and parses it.
//
// Dumb transport on purpose: no parsing here, nothing stored here. The API
// answers 200 for unknown recipients too, so nothing bounces back to Gmail
// (a bounce would make Gmail disable the user's forwarding filter).

export interface Env {
  INTERNAL_API_URL: string;
  INTERNAL_SHARED_SECRET: string;
}

// Email Routing caps messages at 25 MiB; the API's body limit is 26 MiB.
const MAX_BYTES = 25 * 1024 * 1024;
const ATTEMPTS = 3;

export async function deliver(
  message: { from: string; to: string; rawSize: number; raw: ReadableStream<Uint8Array> },
  env: Env,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  if (!env.INTERNAL_SHARED_SECRET) return { ok: false, reason: "not_configured" };
  if (message.rawSize > MAX_BYTES) return { ok: false, reason: "too_large" };

  // Buffer once: a ReadableStream body can't be re-sent on retry.
  const raw = await new Response(message.raw).arrayBuffer();
  const url = `${env.INTERNAL_API_URL.replace(/\/$/, "")}/internal/inbound-email`;

  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-internal-secret": env.INTERNAL_SHARED_SECRET,
          "x-envelope-to": message.to,
          "x-envelope-from": message.from,
        },
        body: raw,
        signal: AbortSignal.timeout(30_000),
      });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status };
      // 4xx (other than 429) won't get better on retry.
      if (res.status < 500 && res.status !== 429) return { ok: false, status: res.status, reason: "rejected" };
    } catch {
      lastStatus = undefined;
    }
    if (attempt < ATTEMPTS) await sleep(attempt * 2000);
  }
  return { ok: false, status: lastStatus, reason: "api_unavailable" };
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const result = await deliver(message, env);
    // Log the outcome only, never addresses or content.
    console.log(JSON.stringify({ event: "inbound", ok: result.ok, status: result.status, reason: result.reason, size: message.rawSize }));
    if (result.ok) return;
    if (result.reason === "too_large") {
      message.setReject("Message too large for SpendVault (max 25 MB)");
      return;
    }
    // API down: throwing makes Email Routing report a temporary failure, so the
    // sending server retries later instead of the mail being dropped silently.
    throw new Error(`SpendVault API unavailable (${result.status ?? "network"})`);
  },
} satisfies ExportedHandler<Env>;
