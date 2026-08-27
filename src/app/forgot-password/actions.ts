"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordResetEmail } from "@/lib/email/password-reset";

export type RequestResetResult = { ok: true } | { error: string };
export type ResetResult = { ok: true } | { error: string };

/**
 * Generates a 6-digit recovery code for `email` and delivers it via nodemailer.
 * Returns a generic success even when the account doesn't exist, so the form
 * can't be used to probe which emails are registered.
 */
export async function requestPasswordReset(
  email: string,
): Promise<RequestResetResult> {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { error: "Enter a valid email address." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: clean,
  });

  // No such user (or any other lookup error) → pretend success, send nothing.
  if (error || !data?.properties?.email_otp) {
    return { ok: true };
  }

  try {
    await sendPasswordResetEmail({
      to: clean,
      code: data.properties.email_otp,
    });
  } catch {
    return { error: "Couldn't send the code. Please try again in a moment." };
  }

  return { ok: true };
}

/**
 * Verifies the emailed recovery code and sets the new password. Verification
 * happens on the cookie-bound server client so the resulting session is stored
 * server-side and the user is signed in on success.
 */
export async function resetPasswordWithCode(
  email: string,
  code: string,
  password: string,
): Promise<ResetResult> {
  const clean = email.trim().toLowerCase();
  if (!/^\d{6,8}$/.test(code)) {
    return { error: "Enter the verification code from your email." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();

  const { error: verifyError } = await supabase.auth.verifyOtp({
    email: clean,
    token: code,
    type: "recovery",
  });
  if (verifyError) {
    return { error: verifyError.message };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return { error: updateError.message };
  }

  return { ok: true };
}
