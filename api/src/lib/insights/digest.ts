// Alert digest email. Pure (no env): the caller passes the absolute URL.
import type { Mail } from "../mailer.js";

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildDigest(to: string, displayName: string, alerts: Array<{ title: string; body: string }>, url: string): Mail {
  const n = alerts.length;
  const subject = n === 1 ? `SpendVault: ${alerts[0].title}` : `SpendVault: ${n} new spending alerts`;
  const hi = `Hi ${displayName.split(/\s+/)[0] || "there"},`;
  const intro = n === 1 ? "SpendVault spotted something in your spending:" : `SpendVault spotted ${n} things in your spending:`;
  const footer = "You get at most one of these a day. Turn them off in SpendVault settings.";
  return {
    to,
    subject,
    text: `${hi}\n\n${intro}\n\n${alerts.map((a) => `- ${a.title}\n  ${a.body}`).join("\n\n")}\n\nSee all alerts:\n${url}\n\n${footer}`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:560px;">
  <p style="font-size:15px;line-height:1.6;">${esc(hi)}</p>
  <p style="font-size:15px;line-height:1.6;">${esc(intro)}</p>
  ${alerts
    .map(
      (a) => `<div style="border-left:3px solid #047857;padding:4px 12px;margin:12px 0;">
    <p style="font-size:15px;font-weight:600;margin:0 0 4px;">${esc(a.title)}</p>
    <p style="font-size:14px;line-height:1.5;margin:0;color:#374151;">${esc(a.body)}</p>
  </div>`,
    )
    .join("\n  ")}
  <p style="margin:24px 0;"><a href="${esc(url)}" style="background:#047857;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">See all alerts</a></p>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;">Button not working? Copy this link into your browser:<br><span style="word-break:break-all;">${esc(url)}</span></p>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;">${esc(footer)}</p>
</div>`,
  };
}
