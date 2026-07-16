---
name: Object storage image serving
description: How uploaded images (e.g. reward images) are stored and served, and why the public serve endpoint is namespace-confined.
---

# Object storage: uploads & serving

Uploaded images (reward images) use the presigned-URL pattern: an admin-only
`POST /storage/uploads/request-url` mints a GCS PUT URL, the browser uploads the
bytes directly to GCS, and the returned `objectPath` (`/objects/uploads/<uuid>`)
is stored in the DB as `/api/storage` + objectPath.

**Serve endpoint `GET /storage/objects/*` is intentionally UNAUTHENTICATED.**
**Why:** images render in `<img src>` tags, which cannot attach the app's
`Authorization: Bearer` header, so an auth-gated serve endpoint would break every
image. Reward images are non-sensitive product images shown to all employees.

**But it MUST stay confined to the `uploads/<uuid>` namespace** (regex-guarded,
404 otherwise). **Why:** without the prefix guard it would behave as a public
file server for the entire `PRIVATE_OBJECT_DIR` — anything else ever placed there
(private docs, exports) would leak. The storage lib ships ACL primitives
(`canAccessObjectEntity`, `ObjectAclPolicy`) that this route does NOT use; the
namespace guard is the access-control mechanism instead.

**How to apply:** if you ever need to store *private* per-user objects, do NOT
widen this endpoint — add a separate auth-gated route that calls
`canAccessObjectEntity`, and keep the public one confined to `uploads/`.

The `signObjectURL` helper in the copied `objectStorage.ts` template needs an
explicit cast on `response.json()` (returns `unknown`) or the api-server
typecheck fails under this project's strict TS config.
