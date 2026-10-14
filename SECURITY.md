# Security Notes

## Credentials

- Docker Compose reads private values from the root `.env`. Service-local `.env`
  files are for manual development and are also ignored. Templates contain no live keys.
- `node scripts/prepare-env.mjs` generates private JWT/preview secrets and applies
  owner-only permissions on Linux/macOS. On Windows, restrict file access using NTFS ACLs.
- Docker environment variables are readable by Docker administrators. An ignored
  plaintext `.env` is not encryption and should not be included in a handover archive.
- Stripe publishable keys are public by design. No secret key belongs in frontend
  code, browser storage, a `VITE_*` variable, a screenshot, or a commit.
- Generated apps have a separate backend `.env`; replace their local demo credentials
  before deployment. Database passwords are hashed; environment files are plaintext.

## Before Pushing Or Sharing

Check that environment variants and private keys are ignored:

```bash
git check-ignore .env .env.production apps/worker/.env
git status --short
```

Review staged changes privately before publishing. Do not print `.env`, unredacted
`docker inspect` output, complete Compose configuration, or reset links into logs.
Scan Git history as well as current files with a secret scanner such as Gitleaks.
Never dismiss an alert merely because the file is now ignored or a key is test-mode.
The repository's Secret Scan workflow checks Git history on pushes and pull requests,
using a pinned scanner image and fully redacted output. Local review is still required
before pushing; a CI scan runs only after the remote has received the commit.

Ignoring a file does not remove an older commit. Old diagnostic helpers previously
contained a plaintext test-account password; those literals have been removed from
the current source. Rotate any password reused from those helpers. Also rotate any
API token shared in chat or screenshots. This change does not rewrite Git history.

When a real credential is exposed: revoke/rotate it at the provider, update `.env`,
recreate the affected containers, and review its usage. Rotate `JWT_SECRET` to invalidate
platform sessions. Coordinate any Git history cleanup with repository collaborators.

## Deployment Boundaries

The supported handover deployment is local Docker Compose. PostgreSQL, Redis, and
the worker's published ports bind to loopback only; the backend
still reaches them over the private Compose network. Before exposing the application publicly,
configure HTTPS, trusted origins/proxies, a separate preview origin, private database
access, backups, least-privilege keys, monitoring, and provider limits. Do not expose the
worker directly to untrusted users or publish test inboxes and default generated admin
credentials. Review crawler network restrictions and isolated execution before accepting
arbitrary public sources in a multi-user production environment.

Password recovery uses expiring, hashed, single-use tokens and revokes old sessions.
Mailtrap Sandbox and Mailpit capture test emails; they do not deliver to real recipients.
Signup email verification is not implemented. Payment activation requires a verified
Stripe webhook, not a client-reported success.

## Reporting

Do not post credentials, reset links, or private user data in a public issue.
Contact the repository owner privately with a minimal redacted reproduction.
