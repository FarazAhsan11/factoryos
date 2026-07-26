"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmployeeInviteEmail } from "@/lib/email/employee-invite";
import {
  ROLE_LABELS,
  addEmployeeSchema,
  employeeIdSchema,
  importEmployeesSchema,
  updateEmployeeRoleSchema,
  type AddEmployeeValues,
  type ImportEmployeesValues,
  type UpdateEmployeeRoleValues,
} from "./schemas";

/**
 * Admin → Employees. Everything here needs the service-role key (creating and
 * deleting auth users), so unlike the Units/Processes lists — which go straight
 * from the browser to Supabase under RLS — these are Server Actions and each
 * one re-authorizes the caller itself.
 */

export type EmployeeResult = { ok: true; warning?: string } | { error: string };

/** Per-row outcome, so the import panel can report exactly what happened. */
export interface ImportRowResult {
  email: string;
  /** The account exists now (whether or not the invite got out). */
  ok: boolean;
  /** The invite email was delivered. */
  invited: boolean;
  /** Why it failed, or why it landed without an invite. */
  error?: string;
}

export type ImportResult =
  | { ok: true; results: ImportRowResult[] }
  | { error: string };

type Admin = ReturnType<typeof createAdminClient>;

interface FactoryBrand {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

/**
 * User management is admin-only — narrower than `canManage` (which includes
 * managers) because it hands out access to the tenant. Returns the caller's
 * id so actions can refuse self-targeting operations.
 */
async function requireFactoryAdmin(
  factoryId: string
): Promise<{ callerId: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, factory_id")
    .eq("id", user.id)
    .single();

  const allowed =
    profile?.role === "super_admin" ||
    (profile?.role === "admin" && profile?.factory_id === factoryId);
  if (!allowed) return { error: "Only a factory admin can manage people." };

  return { callerId: user.id };
}

async function loadFactory(
  admin: Admin,
  factoryId: string
): Promise<FactoryBrand | null> {
  const { data } = await admin
    .from("factories")
    .select("id, name, slug, logo_url")
    .eq("id", factoryId)
    .maybeSingle();
  return (data as FactoryBrand) ?? null;
}

/**
 * Generates a one-time link and emails it. `invite` only works for a brand-new
 * address; imported accounts already exist, so those get a magic link — both
 * land on /auth/confirm → /set-password → their factory dashboard.
 */
async function deliverInvite(
  admin: Admin,
  {
    type,
    email,
    fullName,
    roleLabel,
    factory,
    metadata,
  }: {
    type: "invite" | "magiclink";
    email: string;
    fullName?: string | null;
    roleLabel: string;
    factory: FactoryBrand;
    metadata?: Record<string, unknown>;
  }
): Promise<{ userId?: string }> {
  const { data: link, error } = await admin.auth.admin.generateLink({
    type,
    email,
    ...(metadata ? { options: { data: metadata } } : {}),
  });
  if (error || !link?.properties?.hashed_token) {
    throw new Error(error?.message ?? "Could not generate an invite link.");
  }

  const dashboard = `/factory/${factory.slug ?? ""}`;
  const next = `/set-password?next=${encodeURIComponent(dashboard)}`;
  const inviteUrl = `${siteUrl()}/auth/confirm?token_hash=${
    link.properties.hashed_token
  }&type=${type}&next=${encodeURIComponent(next)}`;

  await sendEmployeeInviteEmail({
    to: email,
    fullName,
    factoryName: factory.name,
    roleLabel,
    inviteUrl,
    logoUrl: factory.logo_url,
  });

  return { userId: link.user?.id };
}

/** Marks the profile as invited; a failure here is cosmetic, never fatal. */
async function stampInvited(admin: Admin, profileId: string) {
  await admin
    .from("profiles")
    .update({ invited_at: new Date().toISOString() })
    .eq("id", profileId);
}

/* ── Add one ────────────────────────────────────────────────────────────── */

/**
 * Creates the account and emails the invite. `generateLink({type:'invite'})`
 * creates the auth user with role/factory_id metadata — the handle_new_user
 * trigger turns that into a profile — and returns a token we deliver ourselves.
 */
export async function addEmployee(
  values: AddEmployeeValues
): Promise<EmployeeResult> {
  const parsed = addEmployeeSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details." };
  }
  const { factoryId, fullName, email, role } = parsed.data;

  const auth = await requireFactoryAdmin(factoryId);
  if ("error" in auth) return auth;

  const admin = createAdminClient();
  const factory = await loadFactory(admin, factoryId);
  if (!factory) return { error: "That factory no longer exists." };

  let userId: string | undefined;
  try {
    const result = await deliverInvite(admin, {
      type: "invite",
      email,
      fullName,
      roleLabel: ROLE_LABELS[role] ?? role,
      factory,
      metadata: { role, factory_id: factoryId, full_name: fullName },
    });
    userId = result.userId;
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    // The invite call creates the user, so distinguish "couldn't create" from
    // "created but the email bounced" by checking whether a profile exists.
    const { data: existing } = await admin
      .from("profiles")
      .select("id, factory_id")
      .eq("email", email)
      .maybeSingle();

    if (!existing) {
      return { error: `Could not add ${email}: ${message}` };
    }
    if (existing.factory_id !== factoryId) {
      return { error: "That email already belongs to another account." };
    }
    await stampInvited(admin, existing.id);
    revalidatePath(`/factory/${factory.slug}/admin`);
    return {
      ok: true,
      warning: `${email} was added, but the invite email failed: ${message}`,
    };
  }

  if (userId) await stampInvited(admin, userId);
  revalidatePath(`/factory/${factory.slug}/admin`);
  return { ok: true };
}

/* ── Bulk import (no email) ─────────────────────────────────────────────── */

/**
 * Creates one batch of accounts from a CSV, optionally emailing each invite as
 * it goes. The client calls this once per batch and advances its progress panel
 * on every resolved call, so the bar tracks real work rather than an animation
 * — batches stay small when invites are on because SMTP dominates the time.
 *
 * A row never fails silently: a created account whose email bounced comes back
 * `ok: true, invited: false` with the reason, and the roster's Send invite
 * picks it up later.
 */
export async function importEmployees(
  values: ImportEmployeesValues
): Promise<ImportResult> {
  const parsed = importEmployeesSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid import." };
  }
  const { factoryId, rows, sendInvites } = parsed.data;

  const auth = await requireFactoryAdmin(factoryId);
  if ("error" in auth) return auth;

  const admin = createAdminClient();
  const factory = await loadFactory(admin, factoryId);
  if (!factory) return { error: "That factory no longer exists." };

  const results: ImportRowResult[] = [];

  for (const row of rows) {
    // Check first so a duplicate reads as "already has an account" instead of
    // surfacing as a create/invite failure further down.
    const { data: existing } = await admin
      .from("profiles")
      .select("id, factory_id")
      .eq("email", row.email)
      .maybeSingle();

    if (existing) {
      results.push({
        email: row.email,
        ok: false,
        invited: false,
        error:
          existing.factory_id === factoryId
            ? "Already in this factory"
            : "Already belongs to another account",
      });
      continue;
    }

    if (!sendInvites) {
      // A throwaway password keeps the account unusable until the person sets
      // their own via a later invite; the email stays unconfirmed until then.
      const { error } = await admin.auth.admin.createUser({
        email: row.email,
        password: crypto.randomUUID(),
        email_confirm: false,
        user_metadata: {
          role: row.role,
          factory_id: factoryId,
          full_name: row.fullName,
        },
      });
      results.push(
        error
          ? { email: row.email, ok: false, invited: false, error: error.message }
          : { email: row.email, ok: true, invited: false }
      );
      continue;
    }

    // generateLink('invite') both creates the user (metadata → profile via the
    // trigger) and yields the token we email ourselves.
    try {
      const { userId } = await deliverInvite(admin, {
        type: "invite",
        email: row.email,
        fullName: row.fullName,
        roleLabel: ROLE_LABELS[row.role] ?? row.role,
        factory,
        metadata: {
          role: row.role,
          factory_id: factoryId,
          full_name: row.fullName,
        },
      });
      if (userId) await stampInvited(admin, userId);
      results.push({ email: row.email, ok: true, invited: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";

      // Did the account get created before the email failed? If so it's a
      // send problem, not an import failure — keep the row and flag it.
      const { data: created } = await admin
        .from("profiles")
        .select("id")
        .eq("email", row.email)
        .maybeSingle();

      results.push(
        created
          ? {
              email: row.email,
              ok: true,
              invited: false,
              error: `Account created, invite email failed: ${message}`,
            }
          : { email: row.email, ok: false, invited: false, error: message }
      );
    }
  }

  revalidatePath(`/factory/${factory.slug}/admin`);
  return { ok: true, results };
}

/* ── Invite an existing (imported) member ───────────────────────────────── */

export async function sendEmployeeInvite(
  profileId: string
): Promise<EmployeeResult> {
  const parsed = employeeIdSchema.safeParse({ profileId });
  if (!parsed.success) return { error: "Invalid request." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name, role, factory_id")
    .eq("id", parsed.data.profileId)
    .maybeSingle();
  if (!profile?.factory_id) return { error: "That person no longer exists." };

  const auth = await requireFactoryAdmin(profile.factory_id);
  if ("error" in auth) return auth;

  const factory = await loadFactory(admin, profile.factory_id);
  if (!factory) return { error: "That factory no longer exists." };

  try {
    await deliverInvite(admin, {
      // The account already exists, so 'invite' would be rejected.
      type: "magiclink",
      email: profile.email,
      fullName: profile.full_name,
      roleLabel: ROLE_LABELS[profile.role] ?? profile.role,
      factory,
    });
  } catch (e) {
    return {
      error: `Could not email ${profile.email}: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    };
  }

  await stampInvited(admin, profile.id);
  revalidatePath(`/factory/${factory.slug}/admin`);
  return { ok: true };
}

/* ── Role change / removal ──────────────────────────────────────────────── */

export async function updateEmployeeRole(
  values: UpdateEmployeeRoleValues
): Promise<EmployeeResult> {
  const parsed = updateEmployeeRoleSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, factory_id")
    .eq("id", parsed.data.profileId)
    .maybeSingle();
  if (!profile?.factory_id) return { error: "That person no longer exists." };

  const auth = await requireFactoryAdmin(profile.factory_id);
  if ("error" in auth) return auth;
  if (auth.callerId === profile.id) {
    return { error: "You can't change your own role." };
  }

  const { error } = await admin
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", profile.id);
  if (error) return { error: error.message };

  // Keep the auth metadata in step so a future re-invite carries the new role.
  await admin.auth.admin.updateUserById(profile.id, {
    user_metadata: { role: parsed.data.role, factory_id: profile.factory_id },
  });

  return { ok: true };
}

/** Removes the person entirely — the auth user goes, the profile cascades. */
export async function removeEmployee(
  profileId: string
): Promise<EmployeeResult> {
  const parsed = employeeIdSchema.safeParse({ profileId });
  if (!parsed.success) return { error: "Invalid request." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, factory_id, role")
    .eq("id", parsed.data.profileId)
    .maybeSingle();
  if (!profile?.factory_id) return { error: "That person no longer exists." };

  const auth = await requireFactoryAdmin(profile.factory_id);
  if ("error" in auth) return auth;
  if (auth.callerId === profile.id) {
    return { error: "You can't remove yourself." };
  }

  // Never leave a tenant with no admin.
  if (profile.role === "admin") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("factory_id", profile.factory_id)
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return { error: "This is the factory's only admin — promote someone else first." };
    }
  }

  const { error } = await admin.auth.admin.deleteUser(profile.id);
  if (error) return { error: error.message };

  return { ok: true };
}
