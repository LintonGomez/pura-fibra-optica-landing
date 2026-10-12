# Pura Fibra Óptica CRM — MVP

A small, authenticated commercial CRM that uses the existing PostgreSQL schema `pfo`. It does not introduce a second customer database, replace n8n, or change the public lead webhook.

## First useful workflow

- List/search up to 200 leads and filter by commercial status.
- View contact and location details.
- Create a lead only when data-processing consent, an explicit separate marketing-consent choice, and the privacy-notice version are recorded.
- Update status, responsible person, next follow-up, notes, and loss reason.
- Record lead activity in `pfo.lead_events` and auditable changes in `pfo.audit_events`.
- Use idempotency keys for lead creation.
- No deletion, outbound messaging, billing, inventory, technical provisioning, or AI-generated actions.

## Architecture

Browser UI → same-origin authenticated HTTP service → parameterized SQL → existing PostgreSQL `pfo` schema.

n8n remains the current workflow orchestrator. This service does not expose PostgreSQL, activate any n8n workflow, or alter the existing `lead-vereda` webhook. The CRM binds only to loopback on the host and is intended to be published behind the existing HTTPS Caddy site at `/crm/`.

Authentication is a single configured administrator for this first increment. Password hashes and session secrets are deployment configuration and must never be committed. Sessions are memory-only and expire after eight hours. State-changing requests require the configured exact Origin.

## Local development

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
npm test
```

Configure the following environment variables before starting the service:

- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `PFO_CRM_USERNAME`
- `PFO_CRM_PASSWORD_HASH` — PBKDF2-SHA256 format produced by `scripts/hash-password.js`
- `PFO_CRM_SESSION_SECRET` — at least 32 random characters
- `PFO_CRM_ALLOWED_ORIGIN` — exact HTTPS origin
- `PFO_CRM_COOKIE_PATH` — `/crm/` in the reverse-proxy deployment
- `PORT` — defaults to 8091

The CRM must use a dedicated `pfo_crm_app` database role, not the existing `pura_fibra_app` bootstrap/superuser. The role is limited to read contacts/leads/events, create/update contacts and leads, append lead events, and append audit records. Do not publish the PostgreSQL port.

## Deployment shape

`deploy-compose.crm.yml` is a Compose overlay for the existing `/root/n8n-docker/docker-compose.yml` stack. It expects source copied to `/root/n8n-docker/pfo-crm`, a protected `/etc/pfo-crm/pfo-crm-db.env` file for the dedicated database role, and `/etc/pfo-crm/pfo-crm-auth.env` for the CRM username, password hash, and session secret. Both files must be mode 600. The overlay binds the service to `127.0.0.1:8091` only. Use `scripts/bootstrap-db-role.sh` to create or constrain the database role after taking a current validated backup; the script never prints the generated password.

The route snippet in `deploy-Caddyfile.snippet` is a reference, not an automatic production change. Publish it only after the application is configured and its authenticated end-to-end checks pass.

## Important current boundaries

- The existing public form currently writes through the legacy `lead-vereda` workflow. Its destination must not be changed as part of this module's deployment.
- Existing legacy and test records are not silently imported. The CRM reads `pfo.leads`; an empty list is expected until the approved intake path writes to that schema.
- Six prepared n8n V2 workflows remain inactive pending webhook authentication, privacy review, and end-to-end acceptance.
- The commercial policy requires at least eight eligible interested households before a zonal technical/economic evaluation. Reaching that threshold is not a promise of coverage or service.
- Public privacy/consent wording and retention policy still require approval. The UI requires the notice version; do not register new contacts unless the actual approved notice and consent process were used.
- This is an MVP, not yet a multi-user role/Controller system. Team permissions can be added when they directly unlock team operation.

## Verification

The automated test suite checks Colombian phone normalization, explicit consent requirements, password hashing, fail-closed configuration, session authentication, same-origin protection, and validation before database writes. A successful unit suite does not by itself certify production deployment or the public intake flow.
