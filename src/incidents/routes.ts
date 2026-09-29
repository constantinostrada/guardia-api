import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Incidente } from "guardia-shared";
import type pg from "pg";
import { CrearIncidenteSchema } from "./schema.js";

interface IncidentRow {
  id: string;
  title: string;
  severity: Incidente["severidad"];
  status: Incidente["estado"];
  created_at: Date;
  closed_at: Date | null;
}

function toIncidente(row: IncidentRow): Incidente {
  return {
    id: row.id,
    titulo: row.title,
    severidad: row.severity,
    estado: row.status,
    creadoEn: row.created_at.toISOString(),
    ...(row.closed_at ? { cerradoEn: row.closed_at.toISOString() } : {}),
  };
}

export const incidentsRoutes: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.post("/incidents", async (request, reply) => {
    const parsed = CrearIncidenteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "El cuerpo no es válido",
        issues: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
      });
    }

    const { titulo, severidad } = parsed.data;
    const { rows } = await pool.query<IncidentRow>(
      `INSERT INTO incidents (id, title, severity, status, created_at, closed_at)
       VALUES ($1, $2, $3, 'abierto', $4, NULL)
       RETURNING id, title, severity, status, created_at, closed_at`,
      [randomUUID(), titulo, severidad, new Date()],
    );

    return reply.code(201).send(toIncidente(rows[0]!));
  });
};
