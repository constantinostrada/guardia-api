import { loadConfig, loadDotEnv } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildServer } from "./server.js";

loadDotEnv();
const config = loadConfig();

const pool = createPool(config.databaseUrl);
const app = buildServer({ apiKey: config.incidentsApiKey, pool });
app.addHook("onClose", async () => {
  await pool.end();
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
