import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Incidente } from "guardia-shared";
import type pg from "pg";
import { crearCodecCursor, type Filtros } from "./cursor.js";
import { CrearIncidenteSchema, ListarIncidentesQuerySchema, TAMANO_PAGINA_POR_DEFECTO } from "./schema.js";

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

interface ListedIncidentRow extends IncidentRow {
  /** created_at con microsegundos, para que el cursor no pierda precisión. */
  cursor_created_at: string;
}

export const incidentsRoutes: FastifyPluginAsync<{ pool: pg.Pool; apiKey: string }> = async (app, { pool, apiKey }) => {
  const cursores = crearCodecCursor(apiKey);

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

  app.get("/incidents", async (request, reply) => {
    const parsed = ListarIncidentesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Los parámetros de consulta no son válidos",
        issues: parsed.error.issues.map(({ path, message, code, ...rest }) => ({
          path,
          message,
          code,
          // Parámetros desconocidos: zod los informa en `keys` con path vacío.
          ...("keys" in rest ? { keys: rest.keys } : {}),
        })),
      });
    }

    const { severidad, estado, cursor, limite = TAMANO_PAGINA_POR_DEFECTO } = parsed.data;
    const filtros: Filtros = { severidad, estado };

    let desde: { creadoEn: string; id: string } | undefined;
    if (cursor !== undefined) {
      const decodificado = cursores.decodificar(cursor, filtros);
      if (!decodificado.ok) {
        const message =
          decodificado.motivo === "filtros"
            ? "El cursor no corresponde a estos filtros: repetí severidad y estado de la primera página"
            : "El cursor no es válido";
        return reply.code(400).send({ error: message, issues: [{ path: ["cursor"], message, code: "custom" }] });
      }
      desde = decodificado.posicion;
    }

    // Keyset sobre (created_at, id) descendente: el id desempata instantes iguales,
    // así ninguna fila se salta ni se repite entre páginas. Se pide una fila de más
    // para saber si hay página siguiente.
    const { rows } = await pool.query<ListedIncidentRow>(
      `SELECT id, title, severity, status, created_at, closed_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM incidents
        WHERE ($1::text[] IS NULL OR severity = ANY($1::text[]))
          AND ($2::text IS NULL OR status = $2::text)
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [severidad ?? null, estado ?? null, desde?.creadoEn ?? null, desde?.id ?? null, limite + 1],
    );

    const pagina = rows.slice(0, limite);
    const ultimo = pagina.at(-1);
    const siguienteCursor =
      rows.length > limite && ultimo
        ? cursores.codificar({ creadoEn: ultimo.cursor_created_at, id: ultimo.id }, filtros)
        : null;

    return { incidentes: pagina.map(toIncidente), siguienteCursor };
  });
};
