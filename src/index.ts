import { loadConfig, loadDotEnv } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildServer } from "./server.js";

loadDotEnv();
const config = loadConfig();

const pool = createPool(config.databaseUrl, (err) => app.log.error({ err }, "error en una conexión ociosa de Postgres"));
const app = buildServer({ apiKey: config.incidentsApiKey, pool });
app.addHook("onClose", async () => {
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
