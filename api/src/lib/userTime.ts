// "Today" in the user's time zone. Pure module (no env/db).
//
// users.timezone is the browser's IANA zone (PATCH /me, sent by the web app).
// Unset → by base currency: INR → Asia/Kolkata, else America/New_York.

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function userTimeZone(u: { timezone?: string | null; baseCurrency?: string | null }): string {
  if (u.timezone && isValidTimeZone(u.timezone)) return u.timezone;
  return u.baseCurrency === "INR" ? "Asia/Kolkata" : "America/New_York";
}

function parts(tz: string, now: Date) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** YYYY-MM-DD in `tz`. */
export const todayIn = (tz: string, now: Date = new Date()) => parts(tz, now).date;

/** 0–23 in `tz`. */
export const hourIn = (tz: string, now: Date = new Date()) => parts(tz, now).hour;

export const todayFor = (u: { timezone?: string | null; baseCurrency?: string | null }, now: Date = new Date()) => todayIn(userTimeZone(u), now);
