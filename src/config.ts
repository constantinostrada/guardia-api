import { existsSync } from "node:fs";

export interface Config {
  databaseUrl: string;
  incidentsApiKey: string;
  host: string;
  port: number;
}

const REQUIRED = ["DATABASE_URL", "INCIDENTS_API_KEY"] as const;

/**
 * Carga .env (si existe) sin pisar variables ya definidas en el entorno.
 */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

/**
 * Valida la configuración crítica. Si falta alguna variable (ausente o vacía)
 * informa todas juntas y termina el proceso antes de abrir el puerto HTTP.
 * Nunca imprime valores, sólo nombres de variables.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    const list = missing.map((name) => `  - ${name}`).join("\n");
    console.error(
      `Error de configuración: faltan variables de entorno obligatorias:\n${list}\n` +
        `Definilas en un archivo .env en la raíz del proyecto (copiá .env.example: cp .env.example .env).`,
    );
    process.exit(1);
  }

  return {
    databaseUrl: env.DATABASE_URL!,
    incidentsApiKey: env.INCIDENTS_API_KEY!,
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT) || 3000,
  };
}
