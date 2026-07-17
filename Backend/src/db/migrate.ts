import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadConfig } from "../config.js";

const { Pool } = pg;

export async function migrate(databaseURL: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseURL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const migrationsDirectory = resolve(process.cwd(), "migrations");
    const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      const existing = await client.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name = $1", [file]);
      if (existing.rowCount) continue;
      const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        process.stdout.write(`Applied ${file}\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  if (!config.databaseURL) throw new Error("DATABASE_URL is required for migrations");
  await migrate(config.databaseURL);
}
