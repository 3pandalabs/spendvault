"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText, Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, errorMessage, setTokens, signup } from "@/lib/api";
import { useNextPath } from "@/lib/hooks";

export default function SignupPage() {
  const router = useRouter();
  const next = useNextPath();
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signup({ ...form, displayName: form.displayName.trim() });
      setTokens(res.accessToken, res.refreshToken);
      router.push(next ?? "/setup");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Couldn't create that account. Try signing in instead."
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-fg-muted">Next, you&apos;ll get a private address to forward statements to.</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Your name" htmlFor="name">
          <Input id="name" required autoComplete="name" value={form.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Email" htmlFor="email" hint="Use the Gmail your bank statements arrive in. It makes setup easier.">
          <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input
            id="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-accent"
          />
          <span>
            I am 18 or older, and I agree to the{" "}
            <Link href="/terms" target="_blank" className="font-medium text-accent hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="font-medium text-accent hover:underline">
              Privacy Policy
            </Link>
            , including SpendVault reading the statements I send it.
          </span>
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null} Create account
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-fg-muted">
        Already have an account?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
