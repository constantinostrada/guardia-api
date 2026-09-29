import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { createShift, findActiveShifts } from "./repository.js";
import { CrearTurnoSchema } from "./schema.js";

export interface ShiftRoutesOptions {
  pool: pg.Pool;
}

export const shiftRoutes: FastifyPluginAsync<ShiftRoutesOptions> = async (app, { pool }) => {
  app.post("/shifts", async (request, reply) => {
    const parsed = CrearTurnoSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Cuerpo inválido",
        detalles: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
          // Campos extra: zod los informa en `keys` con path vacío.
          ...("keys" in issue ? { keys: issue.keys } : {}),
        })),
      });
    }

    // TurnoSchema aplica .trim() a persona; se persiste el valor recibido tal
    // cual para que el solapamiento compare por igualdad exacta, como la columna.
    const { persona } = request.body as { persona: string };
    const result = await createShift(pool, { ...parsed.data, persona });
    if (!result.ok) {
      return reply.code(409).send({
        error: "El turno se solapa con otro turno existente de la misma persona",
        ...(result.existente ? { conflicto: result.existente } : {}),
      });
    }
    return reply.code(201).send(result.turno);
  });

  app.get("/shifts/current", async (_request, reply) => {
    const activos = await findActiveShifts(pool, new Date());
    if (activos.length === 0) {
      return reply.code(204).send();
    }
    return activos;
  });
};
