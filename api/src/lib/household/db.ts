// Household DB side: membership lookups, invites, join/leave.
// Logs ids only (never emails or names).
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { householdInvites, householdMembers, households, users } from "../../db/schema.js";
import { env } from "../../env.js";
import { randomToken, sha256Hex } from "../crypto.js";
import { conflict, DomainError, invalid, notFound } from "../errors.js";
import { anyOnPlus } from "../billing/entitlements.js";
import { sendMail } from "../mailer.js";
import { checkInvite, HOUSEHOLD_MAX_MEMBERS, INVITE_TTL_MS, inviteMail, normalizeEmail } from "./invite.js";

export const householdEnabled = () => env.HOUSEHOLD_ENABLED;

export type HouseholdMember = { userId: string; displayName: string; email: string; role: string; joinedAt: string };

export async function membershipOf(userId: string): Promise<{ householdId: string; role: string } | null> {
  if (!householdEnabled()) return null;
  const [m] = await db
    .select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  return m ?? null;
}

export async function membersOf(householdId: string): Promise<HouseholdMember[]> {
  const rows = await db
    .select({ userId: users.id, displayName: users.displayName, email: users.email, role: householdMembers.role, joinedAt: householdMembers.createdAt })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, householdId), isNull(users.deletedAt)))
    .orderBy(asc(householdMembers.createdAt));
  return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
}

/**
 * User ids whose transactions a household-scoped read may include: every
 * member, or the one `member` asked for (404 if not in the caller's household).
 * Not in a household (or the feature is off) → just the caller.
 */
export async function scopeUserIds(userId: string, scope: "me" | "household" | undefined, member?: string): Promise<{ ids: string[]; members: HouseholdMember[] }> {
  if (scope !== "household") return { ids: [userId], members: [] };
  const m = await membershipOf(userId);
  if (!m) return { ids: [userId], members: [] };
  const members = await membersOf(m.householdId);
  // Combined views need a Plus member in the household (lib/plan.ts; always true with BILLING=off).
  if (!(await anyOnPlus(members.map((x) => x.userId)))) throw new DomainError("PLUS_REQUIRED", "plus_required");
  if (member && member !== "all") {
    if (!members.some((x) => x.userId === member)) throw notFound();
    return { ids: [member], members };
  }
  return { ids: members.map((x) => x.userId), members };
}

/** The `Household` shape from ROUTES.md, or null. */
export async function householdView(userId: string) {
  const m = await membershipOf(userId);
  if (!m) return null;
  const [h] = await db.select().from(households).where(eq(households.id, m.householdId)).limit(1);
  if (!h) return null;
  const [members, invites] = await Promise.all([
    membersOf(h.id),
    db
      .select({ id: householdInvites.id, email: householdInvites.email, expiresAt: householdInvites.expiresAt, createdAt: householdInvites.createdAt })
      .from(householdInvites)
      .where(and(eq(householdInvites.householdId, h.id), isNull(householdInvites.acceptedAt), gt(householdInvites.expiresAt, new Date())))
      .orderBy(asc(householdInvites.createdAt)),
  ]);
  return {
    id: h.id,
    name: h.name,
    role: m.role,
    members: members.map((x) => ({ ...x, isMe: x.userId === userId })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() })),
  };
}

/** Creates the caller's household if needed and emails an invite. */
export async function createInvite(userId: string, rawEmail: string, log: (msg: string) => void): Promise<{ emailed: boolean }> {
  const email = normalizeEmail(rawEmail);
  const [me] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  if (!me) throw notFound();
  if (normalizeEmail(me.email) === email) throw invalid("cannot_invite_self");

  let m = await membershipOf(userId);
  if (!m) {
    const [h] = await db.insert(households).values({ name: `${me.displayName.split(/\s+/)[0] || "Our"} household`, createdBy: userId }).returning();
    await db.insert(householdMembers).values({ householdId: h.id, userId, role: "owner" });
    m = { householdId: h.id, role: "owner" };
  }
  const members = await membersOf(m.householdId);
  if (members.some((x) => normalizeEmail(x.email) === email)) throw conflict("already_member");
  const pending = await db
    .select({ id: householdInvites.id, email: householdInvites.email })
    .from(householdInvites)
    .where(and(eq(householdInvites.householdId, m.householdId), isNull(householdInvites.acceptedAt), gt(householdInvites.expiresAt, new Date())));
  // Re-inviting the same address replaces the old link.
  const others = pending.filter((p) => p.email !== email);
  if (members.length + others.length + 1 > HOUSEHOLD_MAX_MEMBERS) throw conflict("household_full");
  for (const p of pending.filter((p) => p.email === email)) await db.delete(householdInvites).where(eq(householdInvites.id, p.id));

  const secret = randomToken(32);
  const [inv] = await db
    .insert(householdInvites)
    .values({ householdId: m.householdId, email, tokenHash: sha256Hex(secret), invitedBy: userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .returning({ id: householdInvites.id });
  const url = `${env.WEB_ORIGIN}/household/join?token=${encodeURIComponent(secret)}`;
  const res = await sendMail([inviteMail(email, me.displayName, url)], log);
  log(`household invite ${inv.id} delivered=${res.delivered} failed=${res.failed} skipped=${res.skipped}`);
  return { emailed: res.delivered > 0 };
}

/** Invite preview for the join page (inviter name + household name), without accepting. */
export async function previewInvite(userId: string, secret: string) {
  const inv = await inviteBySecret(secret);
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const m = await membershipOf(userId);
  const check = checkInvite(inv, { email: u?.email ?? "", householdId: m?.householdId ?? null });
  if (!inv) return { valid: false as const, code: "invalid_or_expired_token" as const };
  const [h] = await db.select({ name: households.name }).from(households).where(eq(households.id, inv.householdId)).limit(1);
  const [by] = inv.invitedBy ? await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, inv.invitedBy)).limit(1) : [];
  return {
    valid: check.ok,
    code: check.ok ? null : check.code,
    householdName: h?.name ?? "Household",
    invitedBy: by?.displayName ?? null,
    email: inv.email,
  };
}

async function inviteBySecret(secret: string) {
  const [inv] = await db.select().from(householdInvites).where(eq(householdInvites.tokenHash, sha256Hex(secret))).limit(1);
  return inv ?? null;
}

export async function acceptInvite(userId: string, secret: string): Promise<void> {
  const inv = await inviteBySecret(secret);
  const [u] = await db.select({ email: users.email }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  const m = await membershipOf(userId);
  const check = checkInvite(inv, { email: u?.email ?? "", householdId: m?.householdId ?? null });
  if (!check.ok) {
    if (check.code === "invalid_or_expired_token") throw invalid(check.code);
    throw conflict(check.code);
  }
  await db.transaction(async (tx) => {
    if (!m) await tx.insert(householdMembers).values({ householdId: inv!.householdId, userId, role: "member" });
    await tx.update(householdInvites).set({ acceptedAt: new Date() }).where(eq(householdInvites.id, inv!.id));
  });
}

/** Leave; the last member leaving deletes the household (and its pending invites). */
export async function leaveHousehold(userId: string): Promise<void> {
  const m = await membershipOf(userId);
  if (!m) throw notFound();
  await db.delete(householdMembers).where(eq(householdMembers.userId, userId));
  const rest = await membersOf(m.householdId);
  if (rest.length === 0) {
    await db.delete(households).where(eq(households.id, m.householdId));
  } else if (m.role === "owner" && !rest.some((r) => r.role === "owner")) {
    await db.update(householdMembers).set({ role: "owner" }).where(eq(householdMembers.userId, rest[0].userId));
  }
}

export async function cancelInvite(userId: string, inviteId: string): Promise<void> {
  const m = await membershipOf(userId);
  if (!m) throw notFound();
  const del = await db
    .delete(householdInvites)
    .where(and(eq(householdInvites.id, inviteId), eq(householdInvites.householdId, m.householdId), isNull(householdInvites.acceptedAt)))
    .returning({ id: householdInvites.id });
  if (del.length === 0) throw notFound();
}
