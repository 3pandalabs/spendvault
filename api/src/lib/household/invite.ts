// Household invites: pure rules + the invite email. No env/db imports.
//
// A household is a small group (couples first) whose members can read each
// other's transactions in combined dashboards. Joining is always the
// invitee's explicit act: the emailed link only works when they are signed in
// with the invited address and press "Join".

import type { Mail } from "../mailer.js";

/** Members + pending invites per household. */
export const HOUSEHOLD_MAX_MEMBERS = 4;
export const INVITE_TTL_MS = 7 * 24 * 3_600_000;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export type InviteCheck =
  | { ok: true }
  | { ok: false; code: "invalid_or_expired_token" | "wrong_account" | "already_in_household" };

/** Can `user` accept `invite` now? */
export function checkInvite(
  invite: { email: string; expiresAt: Date; acceptedAt: Date | null; householdId: string } | null,
  user: { email: string; householdId: string | null },
  now: Date = new Date(),
): InviteCheck {
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "invalid_or_expired_token" };
  if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) return { ok: false, code: "wrong_account" };
  if (user.householdId && user.householdId !== invite.householdId) return { ok: false, code: "already_in_household" };
  return { ok: true };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim().slice(0, 120);

/** The invite email. Names and links only: never any financial data. */
export function inviteMail(to: string, inviterName: string, joinUrl: string): Mail {
  const who = oneLine(inviterName) || "Someone";
  const text =
    `${who} invited you to share a household on SpendVault.\n\n` +
    `If you join, you'll each see the other's transactions in combined dashboards (your statements, receipts and settings stay your own). ` +
    `You can leave at any time.\n\nJoin: ${joinUrl}\n\nThe link works for 7 days and only when you're signed in with this email address. ` +
    `If you don't know ${who}, ignore this email.\n`;
  return {
    to,
    subject: `${who} invited you to a SpendVault household`,
    text,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:560px;font-size:15px;line-height:1.5">
  <p><b>${esc(who)}</b> invited you to share a household on SpendVault.</p>
  <p>If you join, you'll each see the other's transactions in combined dashboards (your statements, receipts and settings stay your own). You can leave at any time.</p>
  <p><a href="${esc(joinUrl)}" style="display:inline-block;background:#f59e0b;color:#111827;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Join the household</a></p>
  <p style="color:#6b7280;font-size:13px">The link works for 7 days and only when you're signed in with this email address. If you don't know ${esc(who)}, ignore this email.</p>
</div>`,
  };
}
