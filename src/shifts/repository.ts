import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Turno } from "guardia-shared";
import type { CrearTurno } from "./schema.js";

const NO_OVERLAP_CONSTRAINT = "shifts_no_overlap_per_person";
const EXCLUSION_VIOLATION = "23P01";

interface ShiftRow {
  id: string;
  person: string;
  starts_at: Date;
  ends_at: Date;
}

const COLUMNS = "id, person, starts_at, ends_at";

function toTurno(row: ShiftRow): Turno {
  return {
    id: row.id,
    persona: row.person,
    desde: row.starts_at.toISOString(),
    hasta: row.ends_at.toISOString(),
  };
}

export type CreateShiftResult =
  | { ok: true; turno: Turno }
  // `existente` puede faltar si el turno en conflicto se borró entre el
  // rechazo y la consulta; el 409 sigue siendo correcto.
  | { ok: false; existente: Turno | undefined };

// Espacio de claves propio para los advisory locks de turnos (el runner de
// migraciones usa la forma de una sola clave).
const SHIFTS_LOCK_NAMESPACE = 72_616_002;

/**
 * Inserta el turno. La restricción de exclusión de la tabla es la que garantiza
 * el no solapamiento; si salta, se busca el turno existente con el que choca
 * para informarlo.
 *
 * Antes de insertar se toma un advisory lock de transacción por persona: sin él,
 * inserciones concurrentes que compiten por la misma restricción de exclusión
 * pueden abortar con deadlock (40P01) en lugar de fallar limpio con 23P01.
 */
export async function createShift(pool: pg.Pool, nuevo: CrearTurno): Promise<CreateShiftResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [SHIFTS_LOCK_NAMESPACE, nuevo.persona]);
    const { rows } = await client.query<ShiftRow>(
      `INSERT INTO shifts (id, person, starts_at, ends_at)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [randomUUID(), nuevo.persona, nuevo.desde, nuevo.hasta],
    );
    await client.query("COMMIT");
    return { ok: true, turno: toTurno(rows[0]!) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (!isOverlapViolation(err)) throw err;
    return { ok: false, existente: await findOverlapping(pool, nuevo) };
  } finally {
    client.release();
  }
}

async function findOverlapping(pool: pg.Pool, turno: CrearTurno): Promise<Turno | undefined> {
  const { rows } = await pool.query<ShiftRow>(
    `SELECT ${COLUMNS} FROM shifts
     WHERE person = $1
       AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
     ORDER BY starts_at, id
     LIMIT 1`,
    [turno.persona, turno.desde, turno.hasta],
  );
  return rows[0] && toTurno(rows[0]);
}

function isOverlapViolation(err: unknown): boolean {
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === EXCLUSION_VIOLATION && e.constraint === NO_OVERLAP_CONSTRAINT;
}

/** Turnos activos en `now`: desde ≤ now < hasta, por desde y luego id. */
export async function findActiveShifts(pool: pg.Pool, now: Date): Promise<Turno[]> {
  const { rows } = await pool.query<ShiftRow>(
    `SELECT ${COLUMNS} FROM shifts
     WHERE starts_at <= $1 AND ends_at > $1
     ORDER BY starts_at, id`,
    [now],
  );
  return rows.map(toTurno);
}
