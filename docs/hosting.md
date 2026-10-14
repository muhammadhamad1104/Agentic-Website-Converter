# Containers, Domains, And Hosting

## One-Click Local Startup

After the first installation, Docker Desktop can start the existing
**agentic-converter** container group directly. Start the whole group and open
`http://localhost:5173` after its health checks pass. The payment listener must also
run for local Stripe test webhooks. Existing environment configuration and data are
retained; no setup helper is required on ordinary restarts.

Use **Stop**, not **Delete**. An explicitly stopped container stays stopped until
you start it again. Docker itself must be running. To launch Docker at sign-in,
enable its General setting for startup. Code changes need a rebuild/recreation;
environment changes need recreation, and frontend `VITE_*` changes need a rebuild.
See [Docker startup policies](https://docs.docker.com/engine/containers/start-containers-automatically/).

## Published Container Images

The **Publish Container Images** workflow builds and publishes these Linux AMD64
images on relevant pushes to `main`, or through Actions > Run workflow:

```text
ghcr.io/muhammadhamad1104/agentic-website-converter-frontend:latest
ghcr.io/muhammadhamad1104/agentic-website-converter-backend:latest
ghcr.io/muhammadhamad1104/agentic-website-converter-worker:latest
```

Each publication also has a `sha-<full-commit>` tag. Prefer that tag for reproducible
deployments rather than relying on mutable `latest`. The workflow uses GitHub's
short-lived token with package-write permission. Private runtime keys, `.env`, user
data, and generated projects are not uploaded. Images contain the application code,
not the configured database or provider accounts.

Frontend build settings come from repository **Actions variables** `VITE_API_URL`
and `VITE_STRIPE_PUBLISHABLE_KEY`. These are intentionally public browser settings,
not places for Stripe secret keys or other private credentials. Before publishing
for a domain, set the API variable to its HTTPS public origin and rerun the workflow.
An image built for localhost will still call localhost when deployed elsewhere.

GitHub packages can initially be private even for a public source repository. Check
the package's visibility/access before giving images to an evaluator. Private pulls
need registry authentication; anonymous pulls require public visibility. See
[GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

For an evaluator who has their own private `.env`, use Docker Compose 2.24.4+ and
the registry override instead of rebuilding locally:

```bash
docker compose -f docker-compose.yml -f docker-compose.registry.yml pull
docker compose -f docker-compose.yml -f docker-compose.registry.yml up -d --wait db redis
docker compose -f docker-compose.yml -f docker-compose.registry.yml run --rm --no-deps --pull never backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.registry.yml up -d --wait
```

This is a **local evaluation setup**, not a secure public-server deployment. Keep
using the same Compose files for updates. Existing PostgreSQL volumes and worker
data paths remain unchanged. The registry override does not mount local worker
source over the published image. Later Docker Desktop restarts do not pull new
images automatically: pull/recreate once when choosing to update.

## Domain Choices

An extra purchase is optional: a DNS subdomain such as
`converter.muhammadhamad.me` can point to a separate converter server without
replacing the portfolio at the root domain. This is the simplest option if the
existing domain is under your control. It still needs hosting and HTTPS.

The [current GitHub Student Developer Pack](https://education.github.com/pack/)
lists separate Namecheap `.me`, Name.com eligible-extension, and `.TECH` offers.
They are separate provider benefits, not three domains from one registrar. Check
each account's redemption status and terms. The `.me` and `.TECH` registrations are
listed for one year; renewal is not permanently free.

Suggested names, **not availability or price guarantees**: `agenticconverter.dev`,
`agenticconverter.tech`, or `stdconverter.dev`. Premium names or ineligible
extensions may not qualify. Review renewal prices, optional extras, and automatic
renewal before completing registration.

### Name.com Discount Troubleshooting

1. Log out of Name.com, then access its offer from your approved GitHub Education account.
2. Use the [GitHub students partner page](https://www.name.com/partner/github-students)
   and complete **GitHub student verification there**, before choosing a domain.
3. Add an eligible domain and leave the automatically applied promotion unchanged.
4. At checkout, sign in to the intended Name.com account. GitHub verification and
   registrar login are separate steps; a Google login is not itself student verification.
5. Check that valid registrant/contact information is configured. Do not invent an address.
6. If the discount disappears after login, do not pay the higher total. Contact
   [Name.com support](https://www.name.com/support/articles/360036364834-signing-up-for-github-student-developer-pack)
   with the account and cart details privately. Support must resolve account/eligibility
   problems; code changes to this project cannot restore a registrar promotion.

## Recommended Public Hosting Route

**Engineering recommendation:** one Linux VM running the existing Docker Compose
architecture, with an HTTPS reverse proxy, is the most direct initial deployment.
The worker launches Chromium and generated Node applications and needs durable
filesystem storage. A static-only host cannot run this complete application.

[Azure for Students](https://azure.microsoft.com/en-us/free/students/) currently
offers eligible students $100 credit for 12 months without a credit card. Evaluate
an x86-64 Linux VM against your subscription's regional quotas and budget. A practical
starting estimate for a small demonstration is 2 vCPU and 4-8 GB RAM, but measure
actual capture/build usage; free VM sizes may be too small for concurrent conversions.
Disk, public IP, backups, and bandwidth can consume credit too. Configure budget
alerts and do not upgrade to paid billing automatically.

Before going public:

1. Confirm the Azure student subscription and domain/subdomain choice; no VM has
   been provisioned or registrar purchase made by the project workflow.
2. Configure HTTPS frontend, API, and a **separate same-site preview origin**.
3. Rebuild the frontend with its real API URL. Set trusted frontend/CORS/preview
   origins and proxy settings on the backend.
4. Keep PostgreSQL, Redis, and worker endpoints private. The local Compose file is
   not a ready-made internet security boundary; expose only the reverse proxy.
5. Use unique database/admin secrets, durable storage, backups, resource limits,
   and review untrusted-source networking and generated-code isolation.
6. Configure a public signed Stripe webhook rather than the local CLI listener.
   Test mode stays test mode; live payments require a separately eligible Stripe account.
7. Use a verified email-sending domain/provider. Mailtrap sandbox mail is not delivered
   to users' real inboxes. Decide whether signup verification is required.
8. Verify conversion, preview/admin access, exports, payment and recovery against
   the public origins before advertising the service.

Credits and domain offers are temporary benefits, not a promise of unlimited free
hosting or LLM usage. See [SECURITY.md](../SECURITY.md) and the
[handover guide](handover.md) for remaining deployment safeguards.
