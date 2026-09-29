import { loadConfig, loadDotEnv } from "./config.js";
import { buildServer } from "./server.js";

loadDotEnv();
const config = loadConfig();

const app = buildServer();

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
