# Professor Handover

**Project:** Agentic Static to Dynamic Website Converter

**Author:** Muhammad Hamad

**Supported evaluation environment:** Local Docker Compose

**Online student demonstration:** https://agenticconverter.tech, hosted independently
on Azure. See [hosting notes](hosting.md#current-student-deployment) for costs,
private cloud administrator credentials, operational commands, and checked scope.
The online database starts fresh; local conversion history is not copied. Payments
remain in test mode and recovery messages are captured in Mailtrap.

## Materials

Provide the repository, README, MIT license, this guide, and a static website ZIP
whose content you may use. Do not include `.env`, provider keys, real user data,
runtime databases, generated private environments, or node_modules in the public handover.
The evaluator should configure their own credentials privately.

## Start The Demonstration

Follow the first-install commands in [the README](../README.md#quick-start).
On the already configured demonstration machine:

```bash
node scripts/prepare-env.mjs
docker compose up -d --build backend frontend worker
node scripts/setup-local-services.mjs
docker compose --profile demo ps
```

The payment/email helper needs matching Stripe test keys. It preserves configured
Mailtrap SMTP settings; if SMTP is blank, it supplies a local Mailpit testing inbox.
No test keys are supplied by the repository. All application services need to be
running before conversion; PostgreSQL and Redis data must not be deleted.

## Viva Sequence

1. Open `http://localhost:5173`, then sign in or register a Starter account.
2. Show the live conversion count, plan allowance, profile settings, and persistent photo.
3. Create a conversion using an owned static URL or the supplied static website ZIP.
4. Show classification, capture progress, inferred schema, and explicit schema approval.
5. Generate the application and inspect validation/source-completeness reports.
6. Open its preview. Navigate with the preview address bar; append `/admin` to inspect
   the generated CMS. Admin links are not added to the public source website.
7. Sign in using the generated application's private backend `.env`. Edit a page or
   collection, save it, and refresh the public page to demonstrate persistence.
8. Download the ZIP and inspect its README and `export-report.json`. Explain any capture
   or runtime warnings honestly rather than presenting a download as proof of readiness.
9. Leave the project and open another preview to demonstrate runtime lifecycle isolation.
10. With a Starter account, complete Stripe test checkout using the `4242` test card,
    then show the server-confirmed Pro membership and unlimited access.
11. Request a password-reset email, open it in Mailtrap/Mailpit, and choose a new password.
    Demonstrate that the used link cannot reset the password again.

Keep one previously generated project available in case source hosting, provider quotas,
or the demonstration network is unavailable. Do not claim that a saved output represents
a new successful conversion when an external service is down.

## Accounts And Administration

Starter has 5 total conversions. Pro costs $199 USD once and has no application conversion
cap; platform admins also have unlimited access. Provider quotas and resource limits still
apply. Platform users/admins and generated-site admins are separate authentication systems.

Create a separate platform administrator with `SEED_ADMIN_EMAIL` and a unique
`SEED_ADMIN_PASSWORD` in root `.env`, then run:

```bash
docker compose run --rm --no-deps --pull never backend npm run seed
```

This command refuses to silently elevate an existing non-admin user or reset a password.
Use Profile or email recovery to change an existing platform password. Remove seeding
credentials from the environment after provisioning when they are no longer needed.

## What Has Been Exercised

- Frontend workflow, dashboard, profile, checkout, and preview component tests.
- Backend authentication, role/plan rules, recovery, payments, uploads, and preview tests.
- Worker capture, ZIP safety, inference, workflow, export, and runtime tests.
- Real Stripe test-mode decline and successful checkout with webhook-confirmed Pro activation.
- Mailtrap SMTP authentication, actual recovery email delivery to the sandbox, reset-link
  consumption, session revocation, and password-change notification.
- Generated-app browser/admin persistence and source-preserving capture acceptance tests.

Rerun the test commands in the README when evaluating a later version. Unit tests mock
providers; live-provider runs and the opt-in runtime test have separate prerequisites.

## Operational Notes

| Symptom | Check |
| --- | --- |
| Network error in app | Docker is running; backend health endpoint; frontend API origin |
| Old frontend after edits | Rebuild the frontend image; `VITE_*` changes require a new build |
| Preview stays starting | Backend/worker connectivity, Node/npm availability, startup progress, build report |
| Payment succeeded but Starter remains | Stripe test listener, matching account/mode, webhook secret and signature |
| Recovery unavailable | SMTP settings and trusted `FRONTEND_URL`; recreate backend after changes |
| Email not in Gmail | Sandbox emails are captured in Mailtrap/Mailpit, not delivered externally |
| Missing source content | Capture failures, configured limits, unavailable assets, source authentication |

Use `docker compose logs --tail=100 backend worker` for application diagnostics; review
output privately and redact it before sharing. A Stripe listener log can contain its
signing secret. Never publish `.env` or complete container/configuration dumps.

## Remaining Production Work

The local project can be demonstrated and evaluated without treating it as a certified
production service. For public deployment, review and configure:

- HTTPS, public frontend/API origins, a dedicated same-site preview origin, trusted proxies.
- Live Stripe account eligibility, matching live keys, and a public signed webhook endpoint.
- Verified email-sending domain/provider; sandbox SMTP is not real inbox delivery.
- Signup email verification, if required by the deployment's authentication policy.
- Unique database/generated-admin credentials, backups, restoration tests, monitoring,
  resource quotas, and isolation/network restrictions for untrusted conversion sources.
- Rights to source websites, sample media, and any generated/copied content.

Do not run `scripts/deploy.sh` for the viva: its Terraform/AWS provisioning can incur costs.
See [SECURITY.md](../SECURITY.md) for credential handling and previously exposed-password
rotation. The MIT license covers original project code, not third-party website content.
