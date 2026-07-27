// Seeds one factory's setup lists with the prototype's demo data:
// 25 rooms, 25 process stages (machine flags set), 16 product batches.
//
// Idempotent: it reads what's already there and only inserts what's missing,
// so re-running after adding a stage by hand is safe and won't duplicate.
//
// Run:  node --env-file=.env.local scripts/seed-factory-setup.mjs <factory-slug>
//       node --env-file=.env.local scripts/seed-factory-setup.mjs acelpharma --no-products
//
// Reads from env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (server-only key — never expose to the browser)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const skipProducts = args.includes("--no-products");

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Run with: node --env-file=.env.local scripts/seed-factory-setup.mjs <slug>"
  );
  process.exit(1);
}
if (!slug) {
  console.error(
    "Usage: node --env-file=.env.local scripts/seed-factory-setup.mjs <factory-slug> [--no-products]"
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── The prototype's demo factory ─────────────────────────────────────────
// Rooms are non-contiguous on purpose (17A/17B, gaps) — that's what a real
// site looks like, and it catches sorting assumptions.
const UNITS = [
  "1", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
  "17A", "17B", "18", "20", "21A", "21B", "22", "23", "25", "26", "27", "28",
];

// `machine: true` is what splits the shift-log form in two: those stages ask
// for equipment + speed and feed the OEE performance figure. Everything else
// is a state or a manual task, where a speed number would be meaningless.
const PROCESSES = [
  { name: "Manning", machine: false },
  { name: "Materials", machine: false },
  { name: "Set Up", machine: false },
  { name: "Mixing", machine: true },
  { name: "Dispensing", machine: true },
  { name: "Sieving", machine: true },
  { name: "Drying", machine: true },
  { name: "Encapsulation", machine: true },
  { name: "Compression", machine: true },
  { name: "Coating", machine: true },
  { name: "Powder Fill", machine: true },
  { name: "Powder Pack", machine: true },
  { name: "Liquid Filling", machine: true },
  { name: "Labelling", machine: true },
  { name: "Liquid Packing", machine: true },
  { name: "Sorting", machine: false },
  { name: "Testing", machine: false },
  { name: "Reduced Speed", machine: false },
  { name: "Document Recon", machine: false },
  { name: "Prov. Clean", machine: false },
  { name: "Full Clean", machine: false },
  { name: "Maintenance", machine: false },
  { name: "Quality Issue", machine: false },
  { name: "Idle", machine: false },
  { name: "Ready", machine: false },
];

const PRODUCTS = [
  { batch_no: "46004", code: "PC2934", name: "JSHealth Vaginal Probiotic Capsules", required_qty: 1 },
  { batch_no: "45972", code: "PC1868", name: "Quercesorb Capsules", required_qty: 540000 },
  { batch_no: "45721", code: "PC1870", name: "TriMagnesium Citrate 900mg Capsules", required_qty: 1875000 },
  { batch_no: "46244", code: "PC1881", name: "Colon Flush Overnight Cleanse Capsules", required_qty: 525000 },
  { batch_no: "46275", code: "PC2851", name: "Prenatal + Postnatal Sachet Powder", required_qty: 1000 },
  { batch_no: "46000", code: "PC2831", name: "Creatine Creapure Chewable Tablets", required_qty: 200000 },
  { batch_no: "44857", code: "PC2430", name: "Children's MultiCare Chewable Tablets", required_qty: 150000 },
  { batch_no: "46127", code: "PC2714.180", name: "GI Biome Nourish Powder - 180g", required_qty: 5000 },
  { batch_no: "46242", code: "PC2898.500", name: "Melrose MCT Oil Kick Start Liquid - 500ml", required_qty: 10000 },
  { batch_no: "45918", code: "PC2046", name: "PAW HepatoAdvanced (Large Dog) Tablets", required_qty: 75000 },
  { batch_no: "46144", code: "PC2923", name: "Clear Duo Capsules", required_qty: 312500 },
  { batch_no: "46142", code: "PC2192", name: "Balance Hormone Support Capsules", required_qty: 80000 },
  { batch_no: "45490", code: "PC1241", name: "MagGI Restore Vital B Powder", required_qty: 5000 },
  { batch_no: "45492", code: "PC1241.150", name: "MagGI Restore Vital B Powder - 150g", required_qty: 2400 },
  { batch_no: "45491", code: "PC1241.300", name: "MagGI Restore Vital B Powder - 300g", required_qty: 1800 },
  { batch_no: "46199", code: "PC1781.PREMIX", name: "Premium Probiotic 10 2g Sachet", required_qty: 3000 },
];

/** Case-insensitive set of what a table already holds for this factory. */
async function existingKeys(table, column, factoryId) {
  const { data, error } = await admin
    .from(table)
    .select(column)
    .eq("factory_id", factoryId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => String(row[column]).toLowerCase()));
}

async function seedList({ table, column, factoryId, rows, label }) {
  const have = await existingKeys(table, column, factoryId);
  const missing = rows.filter((row) => !have.has(String(row[column]).toLowerCase()));

  if (!missing.length) {
    console.log(`  ${label}: already complete (${have.size} rows) — nothing to add.`);
    return;
  }

  const { error } = await admin.from(table).insert(missing);
  if (error) throw error;
  console.log(`  ${label}: +${missing.length} added (${have.size} were already there).`);
}

async function main() {
  const { data: factory, error } = await admin
    .from("factories")
    .select("id, name, slug, unit_label, unit_label_plural")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!factory) {
    throw new Error(
      `No factory with slug "${slug}". Check /admin for the right one.`
    );
  }

  const unitWord = factory.unit_label ?? "Room";
  console.log(`Seeding "${factory.name}" (${factory.slug})`);

  // sort_order keeps the lists in the prototype's order rather than whatever
  // order Postgres hands back.
  await seedList({
    table: "factory_units",
    column: "name",
    factoryId: factory.id,
    label: factory.unit_label_plural ?? "Units",
    rows: UNITS.map((n, i) => ({
      factory_id: factory.id,
      name: `${unitWord} ${n}`,
      sort_order: i,
      active: true,
    })),
  });

  await seedList({
    table: "factory_processes",
    column: "name",
    factoryId: factory.id,
    label: "Processes",
    rows: PROCESSES.map((p, i) => ({
      factory_id: factory.id,
      name: p.name,
      has_machine: p.machine,
      sort_order: i,
      active: true,
    })),
  });

  if (skipProducts) {
    console.log("  Products: skipped (--no-products).");
  } else {
    await seedList({
      table: "factory_products",
      column: "batch_no",
      factoryId: factory.id,
      label: "Products",
      rows: PRODUCTS.map((p) => ({
        factory_id: factory.id,
        batch_no: p.batch_no,
        code: p.code,
        name: p.name,
        work_order: p.batch_no,
        required_qty: p.required_qty,
        active: true,
      })),
    });
  }

  console.log(`\n✓ Done — open /factory/${factory.slug}/log to log an entry.`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
