"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail } from "lucide-react";

import { TextField } from "@/components/auth/text-field";
import {
  requestPasswordReset,
  resetPasswordWithCode,
} from "@/app/forgot-password/actions";

type Step = "email" | "reset";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    const result = await requestPasswordReset(email);
    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    setStep("reset");
    setNotice(`If an account exists for ${email}, a verification code is on its way.`);
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^\d{6,8}$/.test(code)) {
      setError("Enter the verification code from your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const result = await resetPasswordWithCode(email, code, password);
    if ("error" in result) {
      setLoading(false);
      setError(result.error);
      return;
    }

    // Signed in via the recovery session — route by role from the root.
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <h1 className="text-[2rem] font-semibold leading-tight tracking-tight text-[#0F1B34]">
        {step === "email" ? "Forgot password?" : "Enter your code"}
      </h1>
      <p className="mt-2 text-sm text-[#64748B]">
        {step === "email"
          ? "Enter your email and we'll send you a 6-digit reset code."
          : "Check your inbox, then set a new password below."}
      </p>

      {step === "email" ? (
        <form className="mt-9 space-y-5" onSubmit={sendCode}>
          <TextField
            id="email"
            name="email"
            label="Email"
            icon={Mail}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && <ErrorNote>{error}</ErrorNote>}

          <SubmitButton loading={loading} label="Send code" />

          <p className="text-center text-sm text-[#64748B]">
            <Link href="/login" className="font-medium text-[#2563EB] hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      ) : (
        <form className="mt-9 space-y-5" onSubmit={resetPassword}>
          {notice && (
            <p className="rounded-lg bg-[#EFF6FF] px-3 py-2 text-sm text-[#1D4ED8]">
              {notice}
            </p>
          )}

          <TextField
            id="code"
            name="code"
            label="Verification code"
            icon={KeyRound}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="Code from your email"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="tracking-[0.4em]"
          />

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

          {error && <ErrorNote>{error}</ErrorNote>}

          <SubmitButton loading={loading} label="Reset password" />

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
                setNotice(null);
              }}
              className="inline-flex items-center gap-1 font-medium text-[#64748B] hover:text-[#334155]"
            >
              <ArrowLeft className="size-3.5" />
              Change email
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => sendCode()}
              className="font-medium text-[#2563EB] hover:underline disabled:opacity-60"
            >
              Resend code
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]"
    >
      {children}
    </p>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] active:translate-y-px disabled:pointer-events-none disabled:opacity-70"
    >
      {loading ? "Working…" : label}
      {!loading && (
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
}
