---
name: orval path+query param name collision
description: Why adding a query param to an endpoint that already has a path param breaks the zod codegen, and what to do instead.
---

Adding an `in: query` parameter to an OpenAPI operation that ALREADY has an `in: path`
parameter makes the orval **zod** generator emit two exports with the same name:
- a path-params zod object `<Op>Params` (in `generated/api.ts`), and
- a query-params TYPE `<Op>Params` (in `generated/types/`, because the zod config uses
  `schemas: { path: "generated/types", type: "typescript" }`).

`lib/api-zod/src/index.ts` re-exports both dirs, so `typecheck:libs` fails with
TS2308 "already exported a member named '<Op>Params'". (Operations with only query
params are fine — zod names them `<Op>QueryParams`; the collision only happens when
path + query coexist.)

**Why:** orval's zod client and its typescript schema generator name these differently
and both land in the same barrel export.

**How to apply:** Don't bolt a query param onto a DELETE/GET/etc. that has a path param.
Instead model the extra input as a dedicated sub-resource endpoint with a request body
(e.g. `POST /departments/{id}/reassign` with `{ reassignTo }`) — path + body generates
clean, non-colliding names (like the existing rename PATCH does).
