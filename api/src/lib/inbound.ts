// Personal forwarding addresses. Pure module (no env) so it's unit-tested.
//
// Cloudflare Email Routing has no catch-all on subdomains, so every user shares
// ONE routing rule (`<mailbox>@<domain>` → spendvault-inbound Worker) and is
// told apart by a plus tag: `<mailbox>+<token>@<domain>`. Needs subaddressing
// turned on in Email Routing settings (infra/README.md).

export const forwardingAddressFor = (token: string, mailbox: string, domain: string) => `${mailbox}+${token}@${domain}`;

/** The user token from a recipient local part: the tag after the LAST "+", else the whole local part. */
export function tokenFromLocalPart(local: string | null | undefined): string | null {
  if (!local) return null;
  const tag = local.includes("+") ? local.slice(local.lastIndexOf("+") + 1) : local;
  return tag.trim().toLowerCase() || null;
}
