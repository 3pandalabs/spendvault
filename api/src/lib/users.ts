import type { users } from "../db/schema.js";
import { randomToken } from "./crypto.js";

type UserRow = typeof users.$inferSelect;

/** The `User` shape from ROUTES.md. */
export function userView(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    baseCurrency: u.baseCurrency,
    alertEmails: u.alertEmails,
    deleteOriginals: u.deleteOriginals,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Local part of the forwarding address. 12 chars from a 32-letter alphabet = 60 bits. */
export const newInboundToken = () => randomToken(12);
