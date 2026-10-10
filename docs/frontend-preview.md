# Frontend, Plans, and Preview

The application keeps its React frontend, Express backend, PostgreSQL/Redis queue,
and Python worker. Static-site classification uses the existing classifier.

## Run with Docker Compose

Set `PREVIEW_API_SECRET` in the root `.env` to a random private value. Compose sends
the same value to the backend and worker. It must never be a `VITE_` variable.

Run `docker compose up -d --build`. The frontend is at `http://localhost:5173`,
the API at port 5000, and the separate preview gateway at port 5001. Saved worker
state and generated files are bind-mounted from `apps/worker/data` and
`apps/worker/generated`. Captured pages and media are persisted in
`apps/worker/data/crawl-cache`, mounted at the worker's existing capture path.
PostgreSQL and Redis use the existing named volumes. Captures already lost from
older temporary directories require another crawl; mounting a directory cannot
restore missing files.

For frontend development, run `npm run dev -- --host 127.0.0.1 --port 5174` in
`apps/frontend` when the Compose frontend already occupies 5173. Set the backend
`CORS_ORIGIN` to the frontend origin used for development.

## Plans and Metrics

Starter permits five conversion attempts in total. Deleting a project does not
restore the allowance. Pro is $199 USD paid once, with unlimited conversions.
Administrators have unlimited access regardless of their stored subscription.
The server owns prices and quota checks; role and account status are checked
against the database for authenticated requests.

Counts come from saved projects and worker captures. Average processing time uses
recorded worker trace durations for completed or failed conversions. Records
without measured durations are excluded, and the UI shows the measured sample
count. Missing worker data is shown as unavailable rather than estimated.

Checkout requires Stripe secret/publishable keys and a webhook signing secret.
Configure the webhook for `payment_intent.succeeded` at
`/api/payments/webhook`. Pro activates after the verified webhook records
the payment, not after a browser redirect. Password recovery currently reports
that it is unavailable; an email delivery and reset-token workflow is still needed.

## Preview Lifecycle

Preview starts only when clicked on a project. Each account has one active lease.
Starting another lease replaces the previous one. Leaving the project page,
closing the tab, or stopping preview sends a stop request. Heartbeats renew a
75-second lease, providing cleanup if the browser disconnects before it can stop.
Pending startup is cancellable, and stopping an old lease cannot stop its replacement.

The worker creates a temporary runtime from captured pages, media, schema, and
the project's trusted runtime templates. It uses a separate SQLite database and
an OS-assigned loopback port. Stop terminates its subprocess groups and removes
the temporary files. Preview does not edit exported files or consume another
conversion allowance. The signed preview link expires after one hour; restart
preview to obtain a new link.

Older conversions generated before preserved-source mode preview their captured
site with the current trusted templates. Their original downloaded artifacts are
retained; reconvert those projects to update their exported runtime as well.

The browser accesses the runtime through the backend's separate preview gateway,
so worker container ports do not need to be published dynamically. Run one worker
API process per instance: leases are held in that process's memory. This preview
runner is for the project's trusted templates, not a general sandbox for arbitrary
generated server code.

For a remote deployment, set `PREVIEW_PUBLIC_URL` to a dedicated HTTPS origin on
the same site as the frontend, such as `https://preview.example.com` alongside
`https://app.example.com`. Route it to backend port 5001 and keep the application
API on its own origin. Preview uses an HttpOnly cookie; same-site origins allow
that cookie inside the project iframe. Configure TLS and forwarding headers in
the deployment reverse proxy. Keep the worker API private.

Download remains available when generated artifacts exist, including outputs
with validation warnings. The export report records those warnings. Path,
private-file, and ZIP integrity checks still apply. Invalid file paths are excluded
and recorded in the report; known frontend entry files use their canonical root paths.
