import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

export interface SqlResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>;
}

export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result>;
}

class PgExecutor implements SqlExecutor {
  constructor(private readonly client: Pool | PoolClient) {}

  async query<Row>(text: string, values: readonly unknown[] = []): Promise<SqlResult<Row>> {
    const result = values.length
      ? await this.client.query<QueryResultRow>(text, [...values])
      : await this.client.query<QueryResultRow>(text);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount ?? 0,
    };
  }
}

export interface PostgresDatabaseOptions {
  connectionString: string;
  maximumConnections?: number;
  idleTimeoutMilliseconds?: number;
  connectionTimeoutMilliseconds?: number;
}

export class PostgresDatabase implements TransactionalSqlExecutor {
  private readonly pool: Pool;
  private readonly executor: PgExecutor;

  constructor(options: PostgresDatabaseOptions) {
    const config: PoolConfig = {
      connectionString: options.connectionString,
      max: options.maximumConnections ?? 5,
      idleTimeoutMillis: options.idleTimeoutMilliseconds ?? 10_000,
      connectionTimeoutMillis: options.connectionTimeoutMilliseconds ?? 5_000,
      allowExitOnIdle: true,
    };
    this.pool = new Pool(config);
    this.executor = new PgExecutor(this.pool);
  }

  query<Row>(text: string, values: readonly unknown[] = []): Promise<SqlResult<Row>> {
    return this.executor.query<Row>(text, values);
  }

  async transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PgExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createNeonDatabaseFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): PostgresDatabase {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  if (!connectionString.includes("-pooler.")) {
    console.warn(
      "DATABASE_URL does not look like a Neon pooled connection string; use the -pooler hostname for serverless deployments.",
    );
  }

  return new PostgresDatabase({ connectionString });
}
