import { IncidenteSchema, type Incidente } from "guardia-shared";
import { z } from "zod";

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

export const TAMANO_PAGINA_POR_DEFECTO = 20;
export const TAMANO_PAGINA_MAXIMO = 100;

// Severidad y estado salen del objeto base de IncidenteSchema: los valores
// válidos son sólo los de guardia-shared, sin copiarlos aquí.
const { severidad: SeveridadSchema, estado: EstadoSchema } = IncidenteSchema.innerType().shape;

// Un parámetro repetido (?estado=a&estado=b) llega como array: no es un string.
const unico = (message: string) =>
  z.string({ invalid_type_error: `${message} (el parámetro no puede repetirse)` });

/**
 * Query de GET /incidents. Estricto: cualquier parámetro desconocido es 400.
 * - severidad: uno o varios valores separados por coma (alta,crítica).
 * - estado: abierto | cerrado.
 * - limite: entero entre 1 y 100 (20 si falta).
 * - cursor: opaco; se descifra y valida en la ruta (depende de la clave).
 */
export const ListarIncidentesQuerySchema = z
  .object({
    severidad: unico("severidad debe ser una lista de severidades separadas por coma")
      .transform((value) => value.split(","))
      .pipe(z.array(SeveridadSchema)),
    estado: unico("estado debe ser un único valor").pipe(EstadoSchema),
    limite: unico("limite debe ser un entero")
      .regex(/^\d+$/, { message: `limite debe ser un entero entre 1 y ${TAMANO_PAGINA_MAXIMO}` })
      .transform(Number)
      .pipe(z.number().int().min(1).max(TAMANO_PAGINA_MAXIMO)),
    cursor: unico("cursor debe ser un único valor").min(1, { message: "cursor no puede estar vacío" }),
  })
  .partial()
  .strict();

export type ListarIncidentesQuery = z.infer<typeof ListarIncidentesQuerySchema>;
