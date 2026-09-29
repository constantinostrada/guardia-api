-- Un turno no puede solaparse con otro de la misma persona.
-- Intervalos medio-abiertos [desde, hasta): si uno termina justo cuando empieza
-- el otro no solapan. La persona se compara por igualdad exacta (sin normalizar).
-- Al vivir en la base, dos inserciones concurrentes no pueden terminar ambas bien.

-- btree_gist permite usar `=` sobre text dentro de un índice GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE shifts
  ADD CONSTRAINT shifts_no_overlap_per_person
  EXCLUDE USING gist (
    person WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  );
