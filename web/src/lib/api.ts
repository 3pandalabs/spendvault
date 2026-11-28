"use client";

// Typed client for api/ROUTES.md. The whole web app is client-rendered and
// talks to the API straight from the browser: no server-side fetch means no
// orange-to-orange problem, and the API's bearer check stays the only
// authorization boundary.

import type {
  Account,
  Alert,
  AuthResponse,
  Budgets,
  CategoryInfo,
  Currency,
  Dashboard,
  Document,
  DocumentStatus,
  ExportData,
  ForwardingSetup,
  Household,
  Institution,
  InvitePreview,
  Me,
  MePatch,
  NetWorth,
  NetWorthItem,
  Page,
  PdfPassword,
  Receipt,
  ReceiptDetail,
  ReceiptPatch,
  Savings,
  Subscriptions,
  Transaction,
  TransactionDetail,
  TransactionFilter,
  WhatsappLink,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

// Codes the API puts in `error` or `code` that deserve friendlier copy.
const MESSAGE_COPY: Record<string, string> = {
  invalid_credentials: "That password is wrong. Try again.",
  registration_failed: "Couldn't create that account. Try signing in instead.",
  invalid_or_expired_token: "That link has expired or already been used. Ask for a new one.",
  original_deleted: "The original file was deleted after parsing, so it can't be retried. Upload it again.",
  whatsapp_unavailable: "WhatsApp isn't switched on yet. Use email forwarding or upload for now.",
  rate_limited: "You're doing that too often. Wait a minute and try again.",
  already_member: "That person is already in your household.",
  household_full: "A household can have up to 4 people (including pending invites).",
  cannot_invite_self: "That's your own email. Invite your partner's address instead.",
  wrong_account: "This invite was sent to a different email address. Sign in with that address to join.",
  already_in_household: "You're already in a household. Leave it first to join this one.",
  invalid_category: "That category can't have a budget.",
  transaction_already_linked: "That transaction already has a receipt. Unlink it there first.",
  llm_unavailable: "AI reading isn't switched on yet. Type the total instead.",
  unsupported_file_type: "That file type isn't supported here.",
};

/** Human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const copy = MESSAGE_COPY[e.code ?? ""] ?? MESSAGE_COPY[e.message];
    if (copy) return copy;
    if (e.status === 429) return MESSAGE_COPY.rate_limited;
    if (e.status === 404) return "Not found. It may have been deleted.";
    if (e.status === 413) return "That file is too big. Each file can be up to 10 MB.";
    if (e.message && e.message !== "request_failed") return e.message;
    return "Something went wrong.";
  }
  if (e instanceof TypeError) return "Couldn't reach the server. Check your connection and try again.";
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}

// ---- tokens ----

const ACCESS_KEY = "sv_access_token";
const REFRESH_KEY = "sv_refresh_token";
const TOKEN_EVENT = "sv-tokens";

export function getTokens() {
  if (typeof window === "undefined") return { access: null, refresh: null };
  try {
    return {
      access: window.localStorage.getItem(ACCESS_KEY),
      refresh: window.localStorage.getItem(REFRESH_KEY),
    };
  } catch {
    return { access: null, refresh: null };
  }
}

export function setTokens(access: string, refresh: string) {
  try {
    window.localStorage.setItem(ACCESS_KEY, access);
    window.localStorage.setItem(REFRESH_KEY, refresh);
  } catch {
    /* storage blocked: the session lasts for this page only */
  }
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

export function clearTokens() {
  try {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

/** Subscribe to token changes in this tab and others (for useSyncExternalStore). */
export function subscribeTokens(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(TOKEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(TOKEN_EVENT, onChange);
  };
}

// One refresh in flight at a time: refresh tokens rotate, so two parallel 401s
// each spending the same refresh token would log the user out.
let refreshing: Promise<string | null> | null = null;

function refreshTokens(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refresh } = getTokens();
    if (!refresh) return null;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) {
        clearTokens();
        return null;
      }
      const data = (await res.json()) as AuthResponse;
      setTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function isCredentialError(res: Response): Promise<boolean> {
  const body = (await res.clone().json().catch(() => null)) as { error?: string; code?: string } | null;
  return body?.code === "invalid_credentials" || body?.error === "invalid_credentials";
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  return new ApiError(res.status, body?.error ?? "request_failed", body?.code ?? body?.error);
}

type Opts = { method?: string; body?: unknown; form?: FormData; auth?: boolean };

async function call<T>(path: string, { method = "GET", body, form, auth = true }: Opts = {}): Promise<T> {
  const send = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      method,
      headers: {
        // Only when there IS a JSON body: Fastify rejects a declared-JSON empty
        // body (FST_ERR_CTP_EMPTY_JSON_BODY). FormData sets its own boundary.
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

  let res = await send(auth ? getTokens().access : null);
  // A 401 that names wrong credentials (DELETE /me with a bad password) is an
  // answer, not an expired token: don't burn a refresh on it.
  if (auth && res.status === 401 && !(await isCredentialError(res))) {
    const fresh = await refreshTokens();
    if (!fresh) throw new ApiError(401, "Your session has ended. Please sign in again.", "session_ended");
    res = await send(fresh);
  }
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

// ---- auth ----

export const signup = (b: { email: string; password: string; displayName: string; baseCurrency?: Currency }) =>
  call<AuthResponse>("/auth/signup", { method: "POST", body: b, auth: false });
export const login = (b: { email: string; password: string }) =>
  call<AuthResponse>("/auth/login", { method: "POST", body: b, auth: false });
export async function logout() {
  const { refresh } = getTokens();
  try {
    if (refresh) await call<void>("/auth/logout", { method: "POST", body: { refreshToken: refresh } });
  } finally {
    clearTokens();
  }
}
/** → 204 always (no account enumeration). The email links to /reset-password?token=… */
export const requestPasswordReset = (email: string) =>
  call<void>("/auth/password-reset/request", { method: "POST", body: { email }, auth: false });
export const confirmPasswordReset = (token: string, password: string) =>
  call<void>("/auth/password-reset/confirm", { method: "POST", body: { token, password }, auth: false });

// ---- me / setup ----

export const getMe = () => call<Me>("/me");
export const updateMe = (b: MePatch) => call<Me>("/me", { method: "PATCH", body: b });
export const deleteMe = (password: string) => call<void>("/me", { method: "DELETE", body: { password } });
export const exportMe = () => call<ExportData>("/me/export");
export const getForwarding = () => call<ForwardingSetup>("/setup/forwarding");

// ---- passwords / institutions ----

export const listPasswords = () => call<{ items: PdfPassword[] }>("/pdf-passwords");
export const addPassword = (b: { institution?: string | null; label: string; password: string }) =>
  call<PdfPassword>("/pdf-passwords", { method: "POST", body: b });
export const deletePassword = (id: string) => call<void>(`/pdf-passwords/${enc(id)}`, { method: "DELETE" });
export const listInstitutions = () => call<{ items: Institution[] }>("/institutions", { auth: false });

// ---- documents ----

export const listDocuments = (p: { status?: DocumentStatus; limit?: number; cursor?: string | null } = {}) =>
  call<Page<Document>>(`/documents${qs(p)}`);
export const getDocument = (id: string) => call<Document>(`/documents/${enc(id)}`);
export function uploadDocuments(
  files: File[],
  opts: { source?: "upload" | "share"; kind?: "receipt"; password?: string; savePassword?: boolean } = {},
) {
  const form = new FormData();
  for (const f of files) form.append("file", f, f.name);
  form.append("source", opts.source ?? "upload");
  if (opts.kind) form.append("kind", opts.kind);
  if (opts.password) {
    form.append("password", opts.password);
    form.append("savePassword", opts.savePassword ? "true" : "false");
  }
  return call<{ items: Document[] }>("/documents", { method: "POST", form });
}
export const retryDocument = (id: string, b: { password?: string; savePassword?: boolean } = {}) =>
  call<Document>(`/documents/${enc(id)}/retry`, { method: "POST", body: b });
export const deleteDocument = (id: string, deleteTransactions: boolean) =>
  call<void>(`/documents/${enc(id)}${qs({ deleteTransactions })}`, { method: "DELETE" });

// ---- accounts / transactions ----

export const listAccounts = () => call<{ items: Account[] }>("/accounts");
export const updateAccount = (id: string, label: string | null) =>
  call<Account>(`/accounts/${enc(id)}`, { method: "PATCH", body: { label } });
export const setAccountInNetWorth = (id: string, includeInNetWorth: boolean) =>
  call<Account>(`/accounts/${enc(id)}`, { method: "PATCH", body: { includeInNetWorth } });
export const listTransactions = (f: TransactionFilter = {}) => call<Page<Transaction>>(`/transactions${qs(f)}`);
export const updateTransaction = (id: string, b: { category: string; applyToMerchant?: boolean }) =>
  call<Transaction>(`/transactions/${enc(id)}`, { method: "PATCH", body: b });
export const listCategories = () => call<{ items: CategoryInfo[] }>("/categories", { auth: false });
export const getTransaction = (id: string) => call<TransactionDetail>(`/transactions/${enc(id)}`);

// ---- receipts ----

export const listReceipts = (p: { match?: "all" | "matched" | "unmatched"; limit?: number; cursor?: string | null } = {}) =>
  call<Page<Receipt>>(`/receipts${qs(p)}`);
export const getReceipt = (id: string) => call<ReceiptDetail>(`/receipts/${enc(id)}`);
export const updateReceipt = (id: string, b: ReceiptPatch) => call<ReceiptDetail>(`/receipts/${enc(id)}`, { method: "PATCH", body: b });
export const updateReceiptItem = (id: string, itemId: string, category: string) =>
  call<ReceiptDetail>(`/receipts/${enc(id)}/items/${enc(itemId)}`, { method: "PATCH", body: { category } });
export const receiptCandidates = (id: string) => call<{ items: Array<Transaction & { score: number }> }>(`/receipts/${enc(id)}/candidates`);
export const linkReceipt = (id: string, transactionId: string) =>
  call<ReceiptDetail>(`/receipts/${enc(id)}/link`, { method: "POST", body: { transactionId } });
export const confirmReceipt = (id: string) => call<ReceiptDetail>(`/receipts/${enc(id)}/confirm`, { method: "POST" });
export const unlinkReceipt = (id: string) => call<ReceiptDetail>(`/receipts/${enc(id)}/unlink`, { method: "POST" });
export const extractReceipt = (id: string) => call<ReceiptDetail>(`/receipts/${enc(id)}/extract`, { method: "POST" });
export const rematchReceipts = () => call<{ matched: number }>("/receipts/rematch", { method: "POST" });
export const deleteReceipt = (id: string) => call<void>(`/receipts/${enc(id)}`, { method: "DELETE" });

/** The decrypted receipt image as a blob (bearer-authenticated, so no plain <img src>). */
export async function fetchReceiptImage(id: string): Promise<Blob> {
  const send = (token: string | null) =>
    fetch(`${API_URL}/receipts/${enc(id)}/image`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
  let res = await send(getTokens().access);
  if (res.status === 401) {
    const fresh = await refreshTokens();
    if (!fresh) throw new ApiError(401, "Your session has ended. Please sign in again.", "session_ended");
    res = await send(fresh);
  }
  if (!res.ok) throw await toError(res);
  return res.blob();
}

// ---- dashboard / alerts / savings ----

export const getDashboard = (month?: string, scope?: { scope?: "me" | "household"; member?: string }) =>
  call<Dashboard>(`/dashboard${qs({ month, scope: scope?.scope, member: scope?.member })}`);
export const listAlerts = (p: { includeDismissed?: boolean; limit?: number } = {}) =>
  call<{ items: Alert[] }>(`/alerts${qs(p)}`);
export const dismissAlert = (id: string) => call<void>(`/alerts/${enc(id)}/dismiss`, { method: "POST" });
export const recomputeAlerts = () => call<{ created: number }>("/alerts/recompute", { method: "POST" });
export const getSavings = () => call<Savings>("/savings");
export const getSubscriptions = () => call<Subscriptions>("/subscriptions");

// ---- budgets / net worth ----

export const getBudgets = (month?: string) => call<Budgets>(`/budgets${qs({ month })}`);
export const setBudget = (category: string, amount: number) => call<Budgets>(`/budgets/${enc(category)}`, { method: "PUT", body: { amount } });
export const deleteBudget = (category: string) => call<void>(`/budgets/${enc(category)}`, { method: "DELETE" });
export const setMonthlyBudget = (amount: number | null) => call<Budgets>("/budgets-total", { method: "PUT", body: { amount } });
export const getNetWorth = () => call<NetWorth>("/net-worth");
export const addNetWorthItem = (b: Omit<NetWorthItem, "id" | "updatedAt">) => call<NetWorthItem>("/net-worth/items", { method: "POST", body: b });
export const updateNetWorthItem = (id: string, b: Partial<Omit<NetWorthItem, "id" | "updatedAt">>) =>
  call<NetWorthItem>(`/net-worth/items/${enc(id)}`, { method: "PATCH", body: b });
export const deleteNetWorthItem = (id: string) => call<void>(`/net-worth/items/${enc(id)}`, { method: "DELETE" });

// ---- household ----

export const getHousehold = () => call<{ household: Household | null }>("/household");
export const inviteToHousehold = (email: string) => call<{ emailed: boolean; household: Household }>("/household/invites", { method: "POST", body: { email } });
export const cancelHouseholdInvite = (id: string) => call<void>(`/household/invites/${enc(id)}`, { method: "DELETE" });
export const previewHouseholdInvite = (token: string) => call<InvitePreview>(`/household/join${qs({ token })}`);
export const joinHousehold = (token: string) => call<{ household: Household }>("/household/join", { method: "POST", body: { token } });
export const leaveHousehold = () => call<void>("/household/members/me", { method: "DELETE" });

/** Downloads a bearer-authenticated file (CSV export) via a temporary blob link. */
export async function downloadAuthed(path: string, filename: string): Promise<void> {
  const send = (token: string | null) => fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
  let res = await send(getTokens().access);
  if (res.status === 401) {
    const fresh = await refreshTokens();
    if (!fresh) throw new ApiError(401, "Your session has ended. Please sign in again.", "session_ended");
    res = await send(fresh);
  }
  if (!res.ok) throw await toError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- whatsapp ----

export const linkWhatsapp = () => call<WhatsappLink>("/whatsapp/link", { method: "POST" });
export const unlinkWhatsapp = () => call<void>("/whatsapp/link", { method: "DELETE" });
