# Password Recovery

Recovery is self-service for owners, collaborators, and administrators. Support must
not set another account's password or change its recovery address based on an email
claim. No admin API exposes passwords or raw reset links.

## Configuration

Configure the root `.env` for Docker Compose:

```dotenv
FRONTEND_URL=https://converter.example.com
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@your-domain.example
SUPPORT_EMAIL=support@your-domain.example
```

Use the SMTP provider's credentials, not an ordinary mailbox password. Port 587
requires STARTTLS; port 465 uses TLS immediately. Certificate verification remains
enabled. Register the sender/domain with your provider. `SUPPORT_EMAIL` is optional:
if absent, the app does not invent a contact address. Restart the backend after changing
environment values: `docker compose up -d --no-deps --force-recreate backend`.

Blank or invalid SMTP configuration disables recovery honestly. No reset link is
returned by the API, printed to logs, or displayed as a development shortcut. After
configuration, test delivery to a mailbox you control before deploying. A successful
request response does not reveal whether an address is registered or guarantee SMTP
delivery; inspect the backend's sanitized delivery warnings if mail does not arrive.

## Security

- The existing Redis/BullMQ infrastructure delivers recovery email asynchronously,
  with retries; only the address or notification user ID is queued, never raw tokens.
- Tokens contain 256 random bits. PostgreSQL stores only their SHA-256 hash, with a
  15-minute expiry. A conditional database update makes consumption atomic.
- A five-minute account cooldown and five requests per IP per 15 minutes limit abuse.
- Recovery links target the configured frontend origin, never an incoming Host header.
  The token is a URL fragment, not an HTTP query parameter, and the reset screen removes
  it from the current history entry while retaining it only in component memory.
- New passwords must be 12-256 characters and match confirmation. Passwords are hashed
  with Argon2. Expired, reused, suspended-account, and raced links cannot change passwords.
- Successful recovery revokes all account JWTs and outstanding reset links. The user
  signs in again; recovery does not automatically create a login session.
- Profile changes require the current password. The current session rotates its JWT;
  other sessions and reset links are revoked. SMTP sends a password-change notification.
- Admins can open **Account security** from their dashboard to change their own password.
  Support contact is not identity verification and does not authorize a manual reset.

## Existing Databases

Apply the additive SQL in
`apps/backend/prisma/migrations/20261004_password_recovery/migration.sql` before running
the updated backend, and regenerate Prisma Client. It preserves all existing accounts
and conversion data. This repository's database originally used schema push, so this
SQL can also be applied directly to an existing database without resetting/baselining
unrelated tables. Fresh databases may use `prisma db push` with the updated schema.

Legacy JWTs without a version remain valid only while their account's version is zero.
The first password change permanently invalidates them. Production deployment still
requires HTTPS, a strong JWT secret, restricted database/Redis access, and a correctly
configured trusted reverse proxy for IP-based rate limits.

Reference: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
