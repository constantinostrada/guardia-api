import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { SEVERIDADES, type EstadoIncidente, type Severidad } from "guardia-shared";
import { z } from "zod";

/** Posición del último incidente devuelto según el orden (creado desc, id desc). */
export interface Posicion {
  /** created_at con microsegundos (ISO UTC): la precisión de timestamptz, no la de Date. */
  creadoEn: string;
  id: string;
}

export interface Filtros {
  severidad?: Severidad[];
  estado?: EstadoIncidente;
}

export type CursorDecodificado =
  | { ok: true; posicion: Posicion }
  | { ok: false; motivo: "invalido" | "filtros" };

const IV_BYTES = 12;
const TAG_BYTES = 16;

const PayloadSchema = z
  .object({
    c: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
    i: z.string().uuid(),
    f: z.string(),
  })
  .strict();

/**
 * Los filtros como texto canónico: el mismo conjunto de severidades da la misma
 * clave sin importar orden ni repeticiones (alta,baja = baja,alta,baja).
 */
function claveFiltros({ severidad, estado }: Filtros): string {
  const severidades = severidad ? SEVERIDADES.filter((s) => severidad.includes(s)) : [];
  return `${severidades.join(",")}|${estado ?? ""}`;
}

/**
 * Cursor opaco: la posición y los filtros cifrados con AES-256-GCM. El cliente
 * no ve ids ni fechas, y cualquier cambio de un byte hace fallar la etiqueta de
 * autenticación. La clave se deriva de INCIDENTS_API_KEY (HKDF), así un cursor
 * sigue valiendo tras reiniciar la API y no revela nada de la clave.
 */
export function crearCodecCursor(apiKey: string) {
  const key = Buffer.from(hkdfSync("sha256", apiKey, "guardia-api", "incidents-cursor", 32));

  return {
    codificar(posicion: Posicion, filtros: Filtros): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const payload = JSON.stringify({ c: posicion.creadoEn, i: posicion.id, f: claveFiltros(filtros) });
      const cifrado = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cifrado, cipher.getAuthTag()]).toString("base64url");
    },

    decodificar(token: string, filtros: Filtros): CursorDecodificado {
      let payload: unknown;
      try {
        const raw = Buffer.from(token, "base64url");
        if (raw.length <= IV_BYTES + TAG_BYTES || raw.toString("base64url") !== token) {
          return { ok: false, motivo: "invalido" };
        }
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
        decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
        const claro = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
        payload = JSON.parse(claro.toString("utf8"));
      } catch {
        return { ok: false, motivo: "invalido" };
      }

      const parsed = PayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, motivo: "invalido" };
      if (parsed.data.f !== claveFiltros(filtros)) return { ok: false, motivo: "filtros" };
      return { ok: true, posicion: { creadoEn: parsed.data.c, id: parsed.data.i } };
    },
  };
}

export type CodecCursor = ReturnType<typeof crearCodecCursor>;
