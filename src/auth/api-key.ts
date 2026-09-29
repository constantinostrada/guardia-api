import { createHash, timingSafeEqual } from "node:crypto";
import type { onRequestHookHandler } from "fastify";

export const API_KEY_HEADER = "x-api-key";

const UNAUTHORIZED = { error: "No autorizado" } as const;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Hook onRequest que exige la cabecera x-api-key igual a `expectedKey`
 * (INCIDENTS_API_KEY). Corre antes de parsear y validar el cuerpo, así que una
 * request sin clave válida recibe 401 aunque el cuerpo sea inválido.
 *
 * Se comparan los SHA-256 de ambas claves con timingSafeEqual: largo fijo y
 * tiempo constante, sin revelar el largo de la clave esperada. La respuesta es
 * siempre la misma, sin indicar si faltó la cabecera o no coincidió.
 */
export function requireApiKey(expectedKey: string): onRequestHookHandler {
  const expected = digest(expectedKey);

  return async (request, reply) => {
    const provided = request.headers[API_KEY_HEADER];
    const ok =
      typeof provided === "string" &&
      provided.length > 0 &&
      timingSafeEqual(digest(provided), expected);

    if (!ok) {
      return reply.code(401).send(UNAUTHORIZED);
    }
  };
}
