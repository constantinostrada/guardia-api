import { createHash, timingSafeEqual } from "node:crypto";
import type { onRequestHookHandler } from "fastify";

const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/**
 * Exige la cabecera x-api-key igual a la clave configurada. Se comparan los
 * hashes con timingSafeEqual: tiempo constante y misma longitud siempre, así
 * la comparación no filtra ni el contenido ni el largo de la clave.
 * La respuesta 401 es la misma para cabecera ausente, vacía o incorrecta.
 */
export function apiKeyGuard(apiKey: string): onRequestHookHandler {
  const expected = sha256(apiKey);

  return async (request, reply) => {
    const received = request.headers["x-api-key"];
    const valid =
      typeof received === "string" && received.length > 0 && timingSafeEqual(sha256(received), expected);

    if (!valid) {
      return reply.code(401).send({ error: "No autorizado" });
    }
  };
}
