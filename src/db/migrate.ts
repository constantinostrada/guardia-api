/**
 * CLI de migraciones.
 *
 * Uso:
 *   tsx src/db/migrate.ts up     aplica todas las migraciones pendientes
 *   tsx src/db/migrate.ts down   revierte la última migración aplicada
 */
import { loadDotEnv } from "../config.js";
import { runMigrations } from "./migrations.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "up" && command !== "down") {
    console.error("Uso: migrate.ts <up|down>");
    process.exit(2);
  }

  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error(
      "Error de configuración: falta DATABASE_URL.\n" +
        "Definila en un archivo .env en la raíz del proyecto (copiá .env.example: cp .env.example .env).",
    );
    process.exit(1);
  }

  await runMigrations(databaseUrl, command);
}

main().catch((err: unknown) => {
  console.error("migrate: error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
