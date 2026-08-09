import { PGlite, type Transaction } from "@electric-sql/pglite";

import type {
  SqlExecutor,
  SqlResult,
  TransactionalSqlExecutor,
} from "../database/client";
import { migrateDatabase } from "../database/migrations";

interface Queryable {
  query<Row>(text: string, values?: unknown[]): Promise<{
    rows: Row[];
    affectedRows?: number;
  }>;
  exec?(text: string): Promise<readonly {
    rows: unknown[];
    affectedRows?: number;
  }[]>;
}

class PGliteExecutor implements SqlExecutor {
  constructor(private readonly database: Queryable) {}

  async query<Row>(text: string, values: readonly unknown[] = []): Promise<SqlResult<Row>> {
    if (values.length === 0 && this.database.exec && text.split(";").filter(Boolean).length > 1) {
      const results = await this.database.exec(text);
      const result = results.at(-1);
      return {
        rows: (result?.rows ?? []) as Row[],
        rowCount: result?.affectedRows ?? result?.rows.length ?? 0,
      };
    }
    const result = values.length
      ? await this.database.query<Row>(text, [...values])
      : await this.database.query<Row>(text);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
}

export class PGliteTestDatabase extends PGliteExecutor implements TransactionalSqlExecutor {
  private readonly pglite: PGlite;

  constructor() {
    const pglite = new PGlite();
    super(pglite);
    this.pglite = pglite;
  }

  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result> {
    return this.pglite.transaction((transaction: Transaction) =>
      work(new PGliteExecutor(transaction)),
    );
  }

  async migrate(): Promise<void> {
    await migrateDatabase(this);
  }

  async close(): Promise<void> {
    await this.pglite.close();
  }
}

export async function createMigratedTestDatabase(): Promise<PGliteTestDatabase> {
  const database = new PGliteTestDatabase();
  await database.migrate();
  return database;
}
