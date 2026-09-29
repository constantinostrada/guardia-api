import pg from "pg";

/**
 * Pool de conexiones a Postgres. Un cliente ocioso que pierde la conexión emite
 * "error" en el pool; sin listener ese evento tumbaría el proceso.
 */
export function createPool(databaseUrl: string, onError: (err: Error) => void): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Con la base caída, fallar rápido (→ 500) en lugar de colgar la request.
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", onError);
  return pool;
}
