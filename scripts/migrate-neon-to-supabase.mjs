/**
 * One-shot data migration: Neon → Supabase
 * Source:      PROD_DATABASE_URL (Neon)
 * Destination: DATABASE_URL      (Supabase)
 *
 * Safe to re-run — truncates destination tables before inserting.
 * Inserts in dependency order to satisfy foreign keys.
 */

import pg from "pg";
const { Pool } = pg;

const src = new Pool({
  connectionString: process.env.PROD_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

const dst = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// Insertion order respects foreign key dependencies
const TABLES = [
  "users",
  "user_sessions",
  "conversations",
  "home_conversations",
  "projects",
  "sessions",
  "nexus_messages",
  "chat_messages",
  "entries",
  "thoughts",
  "vault",
  "secrets",
  "blueprints",
  "artifacts",
  "connections",
  "mcp_connections",
  "invites",
  "gallery_images",
  "generated_files",
  "generation_runs",
  "image_versions",
  "project_flow_canvas",
  "project_forge_state",
  "atlas_error_logs",
  "atlas_incidents",
  "atlas_self_map",
  "messages",
  "readiness_snapshots",
  "scheduled_checks",
  "check_results",
  "error_logs",
  "admin_notes",
];

async function tableExists(pool, name) {
  const r = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [name]
  );
  return r.rowCount > 0;
}

async function migrate() {
  console.log("Connecting to source (Neon) and destination (Supabase)...");
  await src.query("SELECT 1");
  await dst.query("SELECT 1");
  console.log("Both databases connected.\n");

  // Disable FK checks in Supabase for the duration
  await dst.query("SET session_replication_role = replica;");

  let totalRows = 0;

  for (const table of TABLES) {
    const srcExists = await tableExists(src, table);
    const dstExists = await tableExists(dst, table);

    if (!srcExists) {
      console.log(`  SKIP  ${table} (not in source)`);
      continue;
    }
    if (!dstExists) {
      console.log(`  SKIP  ${table} (not in destination — run schema push first)`);
      continue;
    }

    // Count source rows
    const countRes = await src.query(`SELECT COUNT(*) FROM "${table}"`);
    const rowCount = parseInt(countRes.rows[0].count, 10);

    if (rowCount === 0) {
      console.log(`  EMPTY ${table}`);
      continue;
    }

    // Truncate destination table
    await dst.query(`TRUNCATE TABLE "${table}" CASCADE`);

    // Get columns that exist in BOTH source and destination
    const srcCols = await src.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    const dstCols = await dst.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    const srcSet = new Set(srcCols.rows.map((r) => r.column_name));
    const dstSet = new Set(dstCols.rows.map((r) => r.column_name));
    const sharedCols = [...dstSet].filter((c) => srcSet.has(c));

    if (sharedCols.length === 0) {
      console.log(`  SKIP  ${table} (no shared columns)`);
      continue;
    }

    // Read only shared columns from source
    const colSel = sharedCols.map((c) => `"${c}"`).join(", ");
    const { rows } = await src.query(`SELECT ${colSel} FROM "${table}"`);

    if (rows.length === 0) {
      console.log(`  EMPTY ${table}`);
      continue;
    }

    // Build parameterised INSERT
    const cols = sharedCols;
    const colList = cols.map((c) => `"${c}"`).join(", ");

    let inserted = 0;
    const BATCH = 200;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [];
      const placeholders = batch.map((row, ri) => {
        const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(", ");
        cols.forEach((col) => values.push(row[col] ?? null));
        return `(${ph})`;
      });

      await dst.query(
        `INSERT INTO "${table}" (${colList}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
        values
      );
      inserted += batch.length;
    }

    totalRows += inserted;
    console.log(`  OK    ${table.padEnd(28)} ${inserted} rows`);
  }

  // Re-enable FK checks
  await dst.query("SET session_replication_role = DEFAULT;");

  // Reset all sequences so new inserts get correct IDs
  console.log("\nResetting sequences...");
  const seqRes = await dst.query(`
    SELECT sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  `);

  for (const { sequence_name } of seqRes.rows) {
    // Derive table name from sequence (drizzle pattern: <table>_id_seq)
    const tableName = sequence_name.replace(/_id_seq$/, "");
    const tExists = await tableExists(dst, tableName);
    if (tExists) {
      await dst.query(
        `SELECT setval('${sequence_name}', COALESCE((SELECT MAX(id) FROM "${tableName}"), 1))`
      );
    }
  }
  console.log("Sequences reset.\n");

  console.log(`Migration complete. ${totalRows} total rows moved to Supabase.`);
  await src.end();
  await dst.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
