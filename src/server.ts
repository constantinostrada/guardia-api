import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type pg from "pg";
import { requireApiKey } from "./auth/api-key.js";
import { shiftRoutes } from "./shifts/routes.js";

export interface ServerOptions {
  apiKey: string;
  pool: pg.Pool;
  /** false desactiva los logs; `stream` permite capturarlos (tests). */
  logger?: false | { level?: string; stream?: { write(line: string): void } };
}

export function buildServer({ apiKey, pool, logger = {} }: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: logger && {
      ...logger,
      // Por si algún día se loguean cabeceras: la clave nunca llega al log.
      redact: { paths: ['req.headers["x-api-key"]'], censor: "[oculto]" },
    },
  });

  // La API sólo acepta JSON: sin el parser de text/plain que Fastify trae por
  // defecto, un cuerpo de texto plano cae en INVALID_MEDIA_TYPE (→ 400 claro).
  app.removeContentTypeParser("text/plain");

  // Sin listener, un error en una conexión inactiva (p. ej. la base se cae)
  // tumbaría el proceso; se registra y la próxima query devolverá 500.
  pool.on("error", (err) => app.log.error({ err }, "error en conexión inactiva del pool"));

  app.setErrorHandler((err: FastifyError, request, reply) => {
    // Errores del propio Fastify al leer el cuerpo (JSON roto, content-type no
    // JSON, cuerpo vacío...): 400 con un mensaje claro y sin traza.
    if (err.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply.code(400).send({ error: "El cuerpo debe ser JSON (Content-Type: application/json)" });
    }
    if (err.code === "FST_ERR_CTP_INVALID_JSON_BODY" || err.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return reply.code(400).send({ error: "El cuerpo no es JSON válido" });
    }
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: "Solicitud inválida" });
    }

    request.log.error({ err }, "error no controlado");
    return reply.code(500).send({ error: "Error interno del servidor" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Rutas protegidas por x-api-key. El hook se declara una sola vez aquí; toda
  // ruta que necesite la clave (turnos, incidentes) se registra en este scope.
  app.register(async (protectedScope) => {
    protectedScope.addHook("onRequest", requireApiKey(apiKey));
    await protectedScope.register(shiftRoutes, { pool });
  });

  return app;
}
