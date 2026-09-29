# convention

A rule the codebase follows — naming, patterns, and where things live.

## API derives request schemas from guardia-shared, never redefines them

What: `CrearTurnoSchema` = `TurnoSchema.innerType().omit({ id: true }).strict()` plus re-applying `TurnoSchema._def.effect` (the desde<hasta refinement) via superRefine · Why: the Turno shape and rules must come only from guardia-shared; `.refine` wraps the object in ZodEffects, so `.omit` is only reachable through `innerType()` and the refinement must be re-attached · Where: src/shifts/schema.ts
