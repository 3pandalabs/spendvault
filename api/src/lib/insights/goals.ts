// Savings goals: progress and "monthly needed". Pure.

import { addMonths, daysBetween, monthOf, round2 } from "./util.js";

export type GoalInput = { targetAmount: number; targetDate: string | null; contributions: ReadonlyArray<{ amount: number; contributedOn: string }> };

export type GoalStatus = "done" | "on_track" | "behind" | "overdue" | "no_date";

export type GoalProgress = {
  saved: number;
  remaining: number;
  /** saved / target, 0..1 (capped). */
  progress: number;
  /** Calendar months left until the target date, counting the current one (0 when the date has passed). */
  monthsLeft: number | null;
  /** remaining / monthsLeft (null without a future target date). */
  monthlyNeeded: number | null;
  /** Average net contribution per month over the last 3 months (this one included). */
  recentMonthlyPace: number;
  status: GoalStatus;
};

/** Months from `today`'s month to the target's month, inclusive of the current month (Dec 10 → Dec 31 = 1). */
export function monthsUntil(today: string, target: string): number {
  if (target < today) return 0;
  const a = monthOf(today);
  const b = monthOf(target);
  let n = 1;
  for (let m = a; m < b; m = addMonths(m, 1)) n++;
  return n;
}

export function goalProgress(g: GoalInput, today: string): GoalProgress {
  const saved = round2(g.contributions.reduce((s, c) => s + c.amount, 0));
  const remaining = round2(Math.max(0, g.targetAmount - saved));
  const progress = g.targetAmount > 0 ? Math.min(1, Math.max(0, saved / g.targetAmount)) : 1;
  const since = addMonths(monthOf(today), -2);
  const recent = g.contributions.filter((c) => monthOf(c.contributedOn) >= since && c.contributedOn <= today).reduce((s, c) => s + c.amount, 0);
  const recentMonthlyPace = round2(recent / 3);
  if (remaining <= 0) return { saved, remaining: 0, progress: 1, monthsLeft: g.targetDate ? monthsUntil(today, g.targetDate) : null, monthlyNeeded: 0, recentMonthlyPace, status: "done" };
  if (!g.targetDate) return { saved, remaining, progress, monthsLeft: null, monthlyNeeded: null, recentMonthlyPace, status: "no_date" };
  const monthsLeft = monthsUntil(today, g.targetDate);
  if (monthsLeft === 0 || daysBetween(today, g.targetDate) < 0) return { saved, remaining, progress, monthsLeft: 0, monthlyNeeded: null, recentMonthlyPace, status: "overdue" };
  const monthlyNeeded = round2(remaining / monthsLeft);
  return { saved, remaining, progress, monthsLeft, monthlyNeeded, recentMonthlyPace, status: recentMonthlyPace + 0.005 >= monthlyNeeded ? "on_track" : "behind" };
}
