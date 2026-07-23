// Seeds the platform Super Admin user via the Supabase Admin API.
//
// Requires the migration in supabase/migrations to be applied first (it needs
// the profiles table + on_auth_user_created trigger to exist).
//
// Run:  node --env-file=.env.local scripts/seed-super-admin.mjs
//
// Reads from env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY        (server-only key — never expose to the browser)
//   SEED_SUPER_ADMIN_EMAIL
//   SEED_SUPER_ADMIN_PASSWORD

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_SUPER_ADMIN_EMAIL;
const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Run with: node --env-file=.env.local scripts/seed-super-admin.mjs"
  );
  process.exit(1);
}
if (!email || !password) {
  console.error(
    "Missing SEED_SUPER_ADMIN_EMAIL or SEED_SUPER_ADMIN_PASSWORD in .env.local."
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const metadata = { full_name: "Super Admin", role: "super_admin" };

async function findUserByEmail(targetEmail) {
  // Small project: scan the first pages of users to find the match.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === targetEmail.toLowerCase()
    );
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  console.log(`Seeding super admin: ${email}`);

  let userId;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

  if (createError) {
    const alreadyExists =
      createError.status === 422 ||
      /already.*regist|exists/i.test(createError.message ?? "");
    if (!alreadyExists) throw createError;

    console.log("User already exists — updating password + metadata.");
    const existing = await findUserByEmail(email);
    if (!existing) throw new Error("User reported as existing but not found.");
    userId = existing.id;

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (updateError) throw updateError;
  } else {
    userId = created.user.id;
    console.log("Auth user created.");
  }

  // Belt-and-suspenders: ensure the profile row exists with the right role
  // (the trigger sets it on insert; this also fixes pre-existing users).
  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: metadata.full_name,
      role: "super_admin",
      factory_id: null,
    },
    { onConflict: "id" }
  );
  if (profileError) {
    console.error(
      "Auth user is set, but writing the profile failed. Is the migration applied?"
    );
    throw profileError;
  }

  console.log(`\n✓ Super admin ready (id: ${userId}, role: super_admin)`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
