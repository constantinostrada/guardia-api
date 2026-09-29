import { IncidenteSchema, type Incidente } from "guardia-shared";

/**
 * Cuerpo de POST /incidents: sólo título y severidad, con las reglas del schema
 * de Incidente de guardia-shared (pick sobre el objeto base, antes del
 * superRefine). Estricto: id, creadoEn, estado, cerradoEn o cualquier otro
 * campo hacen fallar la validación; esos los genera la API.
 */
export const CrearIncidenteSchema = IncidenteSchema.innerType()
  .pick({ titulo: true, severidad: true })
  .strict();

export type CrearIncidente = Pick<Incidente, "titulo" | "severidad">;
