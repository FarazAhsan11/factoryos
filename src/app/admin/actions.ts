"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFactoryInviteEmail } from "@/lib/email/factory-invite";
import { deleteFactorySchema, type DeleteFactoryValues } from "./schemas";

export type CreateFactoryResult =
  | { ok: true; warning?: string }
  | { error: string };

export type DeleteFactoryResult =
  | { ok: true; deletedUsers: number; warning?: string }
  | { error: string };

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

/** Returns an error message when the caller is not a signed-in super admin. */
async function requireSuperAdmin(action: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not signed in.";

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "super_admin") {
    return `Only a super admin can ${action}.`;
  }
  return null;
}

export async function createFactory(
  formData: FormData
): Promise<CreateFactoryResult> {
  // ── 1. Authorize: only a signed-in super admin may create factories ──────
  const denied = await requireSuperAdmin("create factories");
  if (denied) return { error: denied };

  // ── 2. Validate input ────────────────────────────────────────────────────
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const adminEmail = String(formData.get("adminEmail") ?? "")
    .trim()
    .toLowerCase();
  const logo = formData.get("logo");

  if (!name) return { error: "Factory name is required." };
  if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    return { error: "A valid admin email is required." };
  }

  const admin = createAdminClient();

  // ── 3. Unique slug ───────────────────────────────────────────────────────
  let slug = slugify(name) || "factory";
  const { data: clash } = await admin
    .from("factories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  // ── 4. Upload logo (optional) → public URL ───────────────────────────────
  let logoUrl: string | null = null;
  if (logo instanceof File && logo.size > 0) {
    const ext = logo.name.includes(".") ? logo.name.split(".").pop() : "png";
    const path = `${slug}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("factory-logos")
      .upload(path, logo, { contentType: logo.type, upsert: false });
    if (uploadError) {
      return { error: `Logo upload failed: ${uploadError.message}` };
    }
    logoUrl = admin.storage.from("factory-logos").getPublicUrl(path)
      .data.publicUrl;
  }

  // ── 5. Insert the factory ────────────────────────────────────────────────
  const { data: factory, error: insertError } = await admin
    .from("factories")
    .insert({ name, slug, description: description || null, logo_url: logoUrl })
    .select("id, slug")
    .single();
  if (insertError || !factory) {
    return { error: insertError?.message ?? "Could not create the factory." };
  }

  // ── 6. Provision the factory admin + email the invite ────────────────────
  // generateLink(type:'invite') creates the auth user with role/factory_id
  // metadata (the handle_new_user trigger turns that into a profile) and hands
  // back a one-time token we deliver ourselves via nodemailer.
  try {
    const { data: link, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "invite",
        email: adminEmail,
        options: {
          data: { role: "admin", factory_id: factory.id },
        },
      });
    if (linkError || !link?.properties?.hashed_token) {
      throw new Error(linkError?.message ?? "Could not generate an invite.");
    }

    const next = `/set-password?next=${encodeURIComponent(
      `/factory/${factory.slug}`
    )}`;
    const inviteUrl = `${siteUrl()}/auth/confirm?token_hash=${
      link.properties.hashed_token
    }&type=invite&next=${encodeURIComponent(next)}`;

    await sendFactoryInviteEmail({
      to: adminEmail,
      factoryName: name,
      inviteUrl,
      logoUrl,
    });
  } catch (e) {
    // Factory exists; surface the invite/email problem without failing the create.
    revalidatePath("/admin");
    return {
      ok: true,
      warning: `Factory created, but the admin invite could not be sent: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    };
  }

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Permanently deletes a factory and everything scoped to it: every member's
 * auth user + profile, its stored logo files, and the factory row itself.
 * Irreversible — the caller must retype the factory name to confirm.
 */
export async function deleteFactory(
  values: DeleteFactoryValues
): Promise<DeleteFactoryResult> {
  // ── 1. Authorize ─────────────────────────────────────────────────────────
  const denied = await requireSuperAdmin("delete factories");
  if (denied) return { error: denied };

  // ── 2. Re-validate on the server (client-side zod is UX only) ────────────
  const parsed = deleteFactorySchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const { factoryId, confirmName } = parsed.data;

  const admin = createAdminClient();

  // ── 3. Load the factory and check the typed confirmation ────────────────
  const { data: factory, error: loadError } = await admin
    .from("factories")
    .select("id, name, slug")
    .eq("id", factoryId)
    .maybeSingle();
  if (loadError) return { error: loadError.message };
  if (!factory) return { error: "That factory no longer exists." };

  if (confirmName.toLowerCase() !== factory.name.trim().toLowerCase()) {
    return { error: "The name you typed doesn't match this factory." };
  }

  // ── 4. Delete every user belonging to the factory ────────────────────────
  // Deleting the auth user cascades to public.profiles (FK on delete cascade).
  const { data: members, error: membersError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("factory_id", factory.id);
  if (membersError) return { error: membersError.message };

  const failedUsers: string[] = [];
  let deletedUsers = 0;
  for (const member of members ?? []) {
    // Belt-and-braces: a super admin is never factory-scoped, never wipe one.
    if (member.role === "super_admin") continue;
    const { error } = await admin.auth.admin.deleteUser(member.id);
    if (error) failedUsers.push(member.id);
    else deletedUsers += 1;
  }

  // ── 5. Remove stored logos (bucket is keyed by slug) ─────────────────────
  let storageWarning: string | null = null;
  if (factory.slug) {
    const { data: files } = await admin.storage
      .from("factory-logos")
      .list(factory.slug);
    const paths = (files ?? []).map((f) => `${factory.slug}/${f.name}`);
    if (paths.length) {
      const { error } = await admin.storage
        .from("factory-logos")
        .remove(paths);
      if (error) storageWarning = `logo files could not be removed (${error.message})`;
    }
  }

  // ── 6. Delete the factory row ────────────────────────────────────────────
  const { error: deleteError } = await admin
    .from("factories")
    .delete()
    .eq("id", factory.id);
  if (deleteError) return { error: deleteError.message };

  revalidatePath("/admin");

  const warnings = [
    failedUsers.length
      ? `${failedUsers.length} user account(s) could not be deleted`
      : null,
    storageWarning,
  ].filter(Boolean);

  return {
    ok: true,
    deletedUsers,
    warning: warnings.length
      ? `Factory deleted, but ${warnings.join(" and ")}.`
      : undefined,
  };
}
