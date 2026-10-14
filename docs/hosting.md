# Containers, Domains, And Hosting

## Current Student Deployment

Deployed and checked on **October 14, 2026**:

| Item | Configuration |
| --- | --- |
| Application | https://agenticconverter.tech |
| Generated preview origin | https://preview.agenticconverter.tech; access through an authorized project preview |
| DNS | `@`, `www`, and `preview` A records point to `20.192.29.229`; `www` redirects to the application |
| Azure resource group / VM | `agentic-converter-demo` / `agentic-converter` |
| Region / size | Central India / `Standard_B2als_v2`, 2 vCPU, 4 GiB RAM |
| Storage | 64 GiB Standard SSD, persistent database and worker files, 4 GiB swap |
| Services | PostgreSQL, Redis, backend, worker, frontend, and Caddy; no Kubernetes or managed database |
| Network | Only HTTP/HTTPS public; SSH restricted to the owner's provisioning IP |
| Authentication | Separate cloud administrator, database, JWT, and preview secrets |
| Payments / email | Public signed Stripe test webhook; Mailtrap sandbox SMTP, not real inbox delivery |

HTTPS certificates are issued automatically by Caddy without a certificate fee.
The laptop can be turned off; the VM and containers remain online. Docker starts
at server boot and the containers use `restart: unless-stopped`.

Estimated hosting is **$28-30 USD/month from student credit**, including the VM,
disk, and public IPv4, before variable storage operations and egress. The initial
$100 credit therefore covers roughly three months, **not a guaranteed year**.
Azure for Students spending protection was verified **On**. Do not remove it or
upgrade to pay-as-you-go. Stopping a VM is not the same as deallocating it; disk
and public-IP costs can continue even when compute is deallocated. LLM-provider
usage is separate from Azure credit. The domain's renewal is separate from hosting.

The local private root `.env` contains `CLOUD_ADMIN_EMAIL` and
`CLOUD_ADMIN_PASSWORD` for the initial online administrator; local `SEED_ADMIN_*`
credentials are separate. `CLOUD_STRIPE_WEBHOOK_SECRET` is independent of the local
Stripe listener secret. SSH credentials remain in `CLOUD_SSH_PRIVATE_KEY_B64`.
The server's private `/opt/agentic-converter/.env` contains only required runtime
configuration. These files and values must never be committed or sent to evaluators.

On the server, always use all three Compose files:

```bash
cd /opt/agentic-converter
sudo docker compose -f docker-compose.yml -f docker-compose.public.yml -f docker-compose.cloud.yml ps
sudo docker compose -f docker-compose.yml -f docker-compose.public.yml -f docker-compose.cloud.yml up -d --no-build --wait
```

Exact published backend/worker and domain-specific frontend tags are pinned in the
server `.env`; restarting does not silently choose a new `latest` image. To update,
first publish and select tested immutable tags, then pull and recreate with the same
three files. Never run the local/demo override or expose database/worker ports here.

Verified publicly: homepage HTTPS, HTTP-to-HTTPS/www routing, database/cache health,
administrator sign-in, authenticated account/admin summaries, worker health, and a
harmless signed webhook probe. This is a student demonstration, not a production
security certification. Real email delivery, independent backups, generated-code
isolation reviews, and a full cloud conversion/payment acceptance run remain distinct
from these deployment checks. Existing local conversions are not copied to the fresh
cloud database.

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

## Prepared HTTPS Server Setup

`docker-compose.public.yml` is a server-only override preserving the existing
frontend/API/worker/database architecture. It exposes only Caddy on ports 80/443,
routes `/api/*` to the API, keeps database/Redis/worker ports unpublished, and uses
`preview.<PUBLIC_APP_HOST>` for the separate generated-app origin. Production CORS
allows the configured frontend rather than reflecting arbitrary browser origins.
For the actual student deployment and its verified scope, see
[Current Student Deployment](#current-student-deployment). These files alone do not
constitute a production security certification.

On a separately provisioned x86-64 server, configure its own private root `.env`:

- `PUBLIC_APP_HOST=converter.muhammadhamad.me`, or another owned converter subdomain.
- `TLS_CONTACT_EMAIL` for certificate notices.
- Unique random `DB_PASSWORD` (24+ characters), `JWT_SECRET`, and `PREVIEW_API_SECRET`
  (32+ characters). Do not reuse the local PostgreSQL password or copy real user data.
- Required LLM/Stripe/SMTP settings and separately verified provider spending limits.
- A public signed Stripe webhook at `https://<PUBLIC_APP_HOST>/api/payments/webhook`;
  the local Stripe listener is not a public-deployment dependency.

Create DNS A records for the converter hostname and `preview.<PUBLIC_APP_HOST>`
pointing to the VM. Preserve the existing portfolio's root/www records. Check any
AAAA records against the server's actual IPv6 support. Certificate issuance needs
working DNS and inbound HTTP/HTTPS access.

After account credit, spending protection, VM costs, DNS, resource limits, isolation,
and backups are verified, run on **the cloud server**, not the demonstration laptop:

```bash
node scripts/check-public-env.mjs
docker compose -f docker-compose.yml -f docker-compose.public.yml build backend frontend worker
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --wait db redis
docker compose -f docker-compose.yml -f docker-compose.public.yml run --rm --no-deps --pull never backend npm run migrate
docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --no-build --wait
```

The public frontend is rebuilt for the chosen HTTPS origin; registry images built
for localhost must not be reused as the public frontend without that rebuild.
Run the separate admin seed only with intentional private provisioning credentials.
Certificate data persists in private Docker volumes. Use the same two Compose files
for subsequent operations. An Azure spending limit is distinct from a budget alert;
do not remove the limit or upgrade to pay-as-you-go under a zero-fee requirement.

For independent hosting, free-plan capacity and filesystem persistence must cover
the complete converter, not just its attractive frontend. Render's free disks are
ephemeral and Railway's free quota is limited; neither is assumed to satisfy the
full worker's capture/build/storage needs. No local tunnel is used when independent
availability is required.
