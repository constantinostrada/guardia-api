import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/**
 * Errores de Fastify al leer el cuerpo (JSON mal formado, cuerpo vacío,
 * content-type no soportado) → 400 con un mensaje claro. Cualquier otro
 * error → 500 genérico; el detalle queda sólo en el log del servidor.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return reply.code(413).send({ error: "El cuerpo es demasiado grande" });
  }
  if (error.code?.startsWith("FST_ERR_CTP_")) {
    return reply
      .code(400)
      .send({ error: "El cuerpo debe ser un objeto JSON válido enviado con Content-Type: application/json" });
  }

  request.log.error({ err: error }, "error no controlado atendiendo la request");
  return reply.code(500).send({ error: "Error interno del servidor" });
}
