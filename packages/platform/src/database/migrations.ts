import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TransactionalSqlExecutor } from "./client";

export async function readMigrations(directory?: string): Promise<readonly {
  name: string;
  sql: string;
}[]> {
  const resolvedDirectory =
    directory ?? fileURLToPath(new URL("../../migrations", import.meta.url));
  const names = (await readdir(resolvedDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(path.join(resolvedDirectory, name), "utf8"),
    })),
  );
}

export async function migrateDatabase(database: TransactionalSqlExecutor): Promise<void> {
  const migrations = await readMigrations();
  await database.transaction(async (transaction) => {
    await transaction.query(`
      CREATE TABLE IF NOT EXISTS pocketcloud_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await transaction.query("LOCK TABLE pocketcloud_migrations IN EXCLUSIVE MODE");

    for (const migration of migrations) {
      const existing = await transaction.query<{ name: string }>(
        "SELECT name FROM pocketcloud_migrations WHERE name = $1",
        [migration.name],
      );
      if (existing.rowCount > 0) {
        continue;
      }

      await transaction.query(migration.sql);
      await transaction.query("INSERT INTO pocketcloud_migrations (name) VALUES ($1)", [
        migration.name,
      ]);
    }
  });
}
