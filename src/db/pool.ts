import pg from "pg";

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    // Con la base caída, fallar rápido (→ 500) en lugar de colgar la request.
    connectionTimeoutMillis: 5_000,
  });
}
