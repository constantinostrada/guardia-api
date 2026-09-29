import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { apiKeyGuard } from "./auth.js";
import { errorHandler } from "./errors.js";
import { incidentsRoutes } from "./incidents/routes.js";
import { shiftRoutes } from "./shifts/routes.js";

export interface ServerOptions {
  apiKey: string;
  pool: pg.Pool;
  /** Destino de los logs (por defecto stdout). Los tests lo usan para inspeccionarlos. */
  logStream?: NodeJS.WritableStream;
}

export function buildServer({ apiKey, pool, logStream }: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      // El serializer por defecto no incluye cabeceras; el redact es por si alguien lo cambia.
      redact: ['req.headers["x-api-key"]'],
      ...(logStream ? { stream: logStream } : {}),
    },
  });

  app.setErrorHandler(errorHandler);

  app.get("/health", async () => ({ status: "ok" }));

  // Rutas protegidas por x-api-key (incidentes y turnos). El hook se declara una
  // sola vez aquí; toda ruta que necesite la clave se registra en este scope.
  app.register(async (protectedRoutes) => {
    // onRequest corre antes de parsear el cuerpo: sin clave válida es 401 aunque
    // el cuerpo sea inválido o no sea JSON, sin revelar nada del schema.
    protectedRoutes.addHook("onRequest", apiKeyGuard(apiKey));
    // Sólo JSON: sin esto Fastify aceptaría text/plain y lo pasaría como string.
    protectedRoutes.removeContentTypeParser("text/plain");
    await protectedRoutes.register(incidentsRoutes, { pool });
    await protectedRoutes.register(shiftRoutes, { pool });
  });

  return app;
}
