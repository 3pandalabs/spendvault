// Postgres numeric comes back as a string. API responses use numbers in major
// units rounded to 2 dp (ROUTES.md). Pure module.
export const toNum = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100) / 100;

export const num = (v: string | number | null | undefined): number => toNum(v) ?? 0;

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Number → numeric-column string. */
export const toDbAmount = (n: number) => round2(n).toFixed(2);
