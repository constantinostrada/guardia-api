-- Tablas iniciales según el modelo de dominio de guardia-shared.
-- Fechas en timestamptz (el dominio las trata en UTC).

CREATE TABLE incidents (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text        NOT NULL,
  -- Texto + CHECK en lugar de enum: agregar/quitar valores es un ALTER simple.
  severity   text        NOT NULL
             CONSTRAINT incidents_severity_check
             CHECK (severity IN ('baja', 'media', 'alta', 'crítica')),
  status     text        NOT NULL DEFAULT 'abierto'
             CONSTRAINT incidents_status_check
             CHECK (status IN ('abierto', 'cerrado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz,
  -- Cerrado exige fecha de cierre; abierto la prohíbe.
  CONSTRAINT incidents_closed_at_matches_status CHECK (
    (status = 'cerrado' AND closed_at IS NOT NULL)
    OR (status = 'abierto' AND closed_at IS NULL)
  )
);

CREATE TABLE shifts (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  person    text        NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at   timestamptz NOT NULL,
  CONSTRAINT shifts_ends_after_starts CHECK (ends_at > starts_at)
);
