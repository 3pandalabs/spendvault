import type { Mail, SendResult } from "./mailer.js";

// "SpendVault New user" email to the org inbox whenever someone signs up
// (2026-11-26, owner request; mirrors AdVault's lib/newUserAlert.ts).
// The only path that alerts is POST /auth/signup after a real insert; a taken
// address (onConflictDoNothing -> 409) and the SQL demo seed
// (test/insights/fixtures/demo-seed.sql) send nothing.
//
// Account details only (app, email, display name, time, id): never any
// financial data. Fire-and-forget: a mailer failure never fails or delays a
// sign-up. NEW_USER_ALERT_EMAIL overrides the recipient; "off" turns it off.
//
// Pure: no env/db imports (the mailer is injected), so vitest runs it as is.

export const DEFAULT_NEW_USER_ALERT_TO = "3pandas@3pandalabs.com";

export function newUserAlertTo(raw: string | undefined = process.env.NEW_USER_ALERT_EMAIL): string | null {
  const v = raw?.trim();
  if (v?.toLowerCase() === "off") return null;
  return v || DEFAULT_NEW_USER_ALERT_TO;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

export type NewUser = { email: string; userId: string; displayName?: string | null; at?: Date };

export function newUserMail(to: string, u: NewUser): Mail {
  const at = (u.at ?? new Date()).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const name = u.displayName ? oneLine(u.displayName) : "";
  const rows: [string, string][] = [
    ["App", "SpendVault"],
    ["Email", oneLine(u.email)],
    ...(name ? ([["Name", name]] as [string, string][]) : []),
    ["Signed up", at],
    ["User id", u.userId],
  ];
  return {
    to,
    subject: "SpendVault New user",
    text: `New SpendVault sign-up.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:560px">
  <p style="font-size:15px"><b>New SpendVault sign-up</b></p>
  <table style="font-size:14px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="color:#6b7280;padding:2px 12px 2px 0">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("")}</table>
</div>`,
  };
}

export type AlertDeps = {
  send: (messages: Mail[], log: (msg: string) => void) => Promise<SendResult>;
  configured: () => boolean;
  log: (msg: string) => void;
  /** Recipient override for tests; undefined reads NEW_USER_ALERT_EMAIL. */
  to?: string | null;
};

/** Sends the alert in the background. Never throws, never awaited by the sign-up. */
export function notifyNewUser(u: NewUser, deps: AlertDeps): void {
  try {
    const to = deps.to === undefined ? newUserAlertTo() : deps.to;
    if (!to || !deps.configured()) return;
    void Promise.resolve()
      .then(() => deps.send([newUserMail(to, u)], deps.log))
      .then((r) => {
        if (r.failed || r.skipped) deps.log(`new user alert not delivered (failed=${r.failed} skipped=${r.skipped})`);
      })
      .catch((err) => deps.log(`new user alert failed: ${String(err)}`));
  } catch (err) {
    deps.log(`new user alert failed: ${String(err)}`);
  }
}
