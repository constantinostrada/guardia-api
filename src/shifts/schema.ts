import { TurnoSchema, type Turno } from "guardia-shared";

/**
 * Cuerpo de POST /shifts: el Turno de guardia-shared sin `id` (lo genera la API).
 *
 * Se deriva del schema compartido en vez de redefinirlo: se toma el objeto base
 * de TurnoSchema, se quita `id`, se mantiene estricto (cualquier campo extra,
 * `id` incluido, es un error) y se vuelve a aplicar la misma regla de orden
 * desde/hasta que TurnoSchema ya declara.
 */
const turnoRefinement = TurnoSchema._def.effect;

export const CrearTurnoSchema = TurnoSchema.innerType()
  .omit({ id: true })
  .strict()
  .superRefine((turno, ctx) => {
    if (turnoRefinement.type === "refinement") {
      // La regla sólo lee desde/hasta; `id` no participa.
      return turnoRefinement.refinement(turno as Turno, ctx);
    }
  });

export type CrearTurno = Omit<Turno, "id">;
