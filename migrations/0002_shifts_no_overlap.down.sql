ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_no_overlap_per_person;
DROP EXTENSION IF EXISTS btree_gist;
