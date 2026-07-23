"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";

import { TextField } from "@/components/auth/text-field";
import { createClient } from "@/lib/supabase/client";

// Where each role lands after signing in.
function routeForRole(role: string | null | undefined) {
  if (role === "super_admin") return "/admin";
  return "/"; // TODO: factory dashboard / onboarding for tenant roles
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Unable to sign in.");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    router.replace(routeForRole(profile?.role));
    router.refresh();
  }

  return (
    <>
      <h1 className="text-[2rem] font-semibold leading-tight tracking-tight text-[#0F1B34]">
        Welcome back
      </h1>
      <p className="mt-2 text-sm text-[#64748B]">
        Sign in to your factory workspace to start your shift.
      </p>

      <form className="mt-9 space-y-5" onSubmit={handleSubmit}>
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

        <TextField
          id="password"
          name="password"
          label="Password"
          icon={Lock}
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="••••••••••"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          labelAction={
            <a
              href="#"
              className="text-xs font-medium text-[#2563EB] hover:underline"
            >
              Forgot?
            </a>
          }
          trailing={
            <button
              type="button"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] transition hover:text-[#475569]"
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          }
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
          disabled={loading}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] active:translate-y-px disabled:pointer-events-none disabled:opacity-70"
        >
          {loading ? "Signing in…" : "Sign in"}
          {!loading && (
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </button>
      </form>

      <p className="mt-8 text-center text-xs text-[#94A3B8]">
        By continuing you agree to the{" "}
        <a href="#" className="underline hover:text-[#64748B]">
          Terms
        </a>{" "}
        and{" "}
        <a href="#" className="underline hover:text-[#64748B]">
          Privacy Policy
        </a>
        .
      </p>
    </>
  );
}
