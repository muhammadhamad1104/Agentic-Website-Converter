# Profile Photos

Photos are stored on the authenticated account in PostgreSQL, not in an ephemeral
container folder. They survive signing out, using another device, and restarting
containers while the existing database volume is retained.

Apply `apps/backend/prisma/migrations/20261005_profile_photo/migration.sql` to existing
databases before deploying the updated backend, then regenerate Prisma Client.
This additive migration preserves existing accounts and conversion data.

`PUT /api/auth/avatar` accepts one multipart `photo` file; `DELETE /api/auth/avatar`
removes the current account's photo. Authentication and rate limiting apply to both.
Neither endpoint accepts a destination account ID. The normal profile endpoint does
not accept arbitrary avatar URLs.

Uploads are limited to 5 MB and 24 megapixels. JPEG, PNG, WebP, and GIF content is
checked by signature, decoded, rotated for orientation, and re-encoded as a 256px
WebP portrait. SVG, invalid images, and extra multipart fields are rejected. Original
metadata is not retained. The resulting data URL is returned in the authenticated
account's `avatarUrl` field, including `/auth/me` and login responses.

Image handling follows [Sharp's input limits](https://sharp.pixelplumbing.com/api-constructor/)
and [default metadata removal](https://sharp.pixelplumbing.com/api-output/).

# Brand Assets

`apps/frontend/public/brand/mark.svg` is the editable logo source. Two linked browser
windows and a forward arrow represent the transition from a source website to an
editable application. `favicon.svg` is the dark icon variant. Regenerate raster tab
and mobile icons with `node apps/backend/scripts/build-brand.cjs` after editing it.
Public deployment and search-engine recrawling are required before search results
can reflect the new favicon; localhost is not publicly indexed.
