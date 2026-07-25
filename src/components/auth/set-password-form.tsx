"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";

import { TextField } from "@/components/auth/text-field";
import { createClient } from "@/lib/supabase/client";

export function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // The invite link must have established a session (via /auth/confirm). If not,
  // the link was already used or expired — send them to sign in.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login?error=invalid_link");
        return;
      }
      setReady(true);
    });
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <>
      <h1 className="text-[2rem] font-semibold leading-tight tracking-tight text-[#0F1B34]">
        Set your password
      </h1>
      <p className="mt-2 text-sm text-[#64748B]">
        Choose a password to activate your Factory Admin account.
      </p>

      <form className="mt-9 space-y-5" onSubmit={handleSubmit}>
        <TextField
          id="password"
          name="password"
          label="New password"
          icon={Lock}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          trailing={
            <button
              type="button"
              tabIndex={-1}
              aria-label={show ? "Hide password" : "Show password"}
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] transition hover:text-[#475569]"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />

        <TextField
          id="confirm"
          name="confirm"
          label="Confirm password"
          icon={Lock}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !ready}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] active:translate-y-px disabled:pointer-events-none disabled:opacity-70"
        >
          {loading ? "Saving…" : "Activate account"}
          {!loading && (
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </button>
      </form>
    </>
  );
}
