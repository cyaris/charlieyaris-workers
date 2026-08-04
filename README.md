# Charlie Yaris Workers

Cloudflare Worker for the `charlieyaris.com` contact form.

The Worker accepts contact-form `POST` requests from the allowed site origins, validates the Turnstile token, sends the message through Resend, and sends a best-effort confirmation email back to the visitor.

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/index.js` | Worker entrypoint and contact-form handler |
| `test/index.spec.js` | Vitest test file |
| `wrangler.jsonc` | Cloudflare Worker configuration |

## Requirements

- Node.js and npm
- A Cloudflare account with Workers access
- A Resend API key for the verified sending domain
- A Cloudflare Turnstile secret key for `charlieyaris.com`

## Install

```bash
npm install
```

## Configuration

The Worker name and public variables are configured in `wrangler.jsonc`.

Current production variables:

- `CONTACT_FROM_EMAIL` - sender address shown on outgoing emails
- `CONTACT_TO_EMAIL` - inbox that receives contact-form messages

Sensitive values must be configured as Worker secrets:

- `RESEND_API_KEY`
- `TURNSTILE_SECRET_KEY`

For local development, create a `.dev.vars` file in this directory:

```dotenv
RESEND_API_KEY="re_..."
TURNSTILE_SECRET_KEY="..."
```

Do not commit `.dev.vars` or `.env` files.

## Local Development

Start the Worker locally:

```bash
npm run dev
```

Wrangler will print the local URL, usually `http://localhost:8787`.

The contact handler only accepts `POST` and `OPTIONS` requests from origins listed in `src/index.js`. Local frontend origins currently include:

- `http://localhost:4000`
- `http://127.0.0.1:4000`

## Deploy

Authenticate Wrangler with Cloudflare:

```bash
npx wrangler login
```

Confirm Wrangler is using the expected Cloudflare account:

```bash
npx wrangler whoami
```

Create the required production secrets. Each command prompts for the secret value:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Optional: run a deploy dry run first:

```bash
npx wrangler deploy --dry-run
```

Deploy the Worker locally:

```bash
npm run deploy
```

This runs `wrangler deploy` using `wrangler.jsonc`. The configured Worker name is `contact-form-worker`, and `workers_dev` is enabled, so Cloudflare will publish it to the account's `workers.dev` subdomain unless routes or custom domains are added to `wrangler.jsonc`.

Pushes to `main` also deploy automatically through `.github/workflows/deploy.yml`; see
[GitHub Actions Workflows](#github-actions-workflows) for the required repository secret and variable.

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run deploy` | Deploy to Cloudflare Workers |
| `npm run dev` | Start local Wrangler dev server |
| `npm run format` | Format project files |
| `npm test` | Run Vitest |

## Production Checklist

Before deploying, verify:

- `CONTACT_FROM_EMAIL` uses a Resend-verified sending domain.
- `CONTACT_TO_EMAIL` points to the destination inbox.
- `RESEND_API_KEY` is set as a Worker secret.
- `TURNSTILE_SECRET_KEY` is set as a Worker secret.
- The production frontend origin is included in `ALLOWED_ORIGINS`.
- The Turnstile hostname is included in `ALLOWED_TURNSTILE_HOSTNAMES`.

## GitHub Actions Workflows

These local wrappers inherit their reusable implementations from `cyaris/shared-automation`. Shared workflow behavior,
inputs, and secrets are documented in the
[shared-automation workflow reference](https://github.com/cyaris/shared-automation#workflows).

This repository keeps a `dev` branch open for active development. `.github/workflows/auto-create-dev-pr.yml` is a thin
wrapper around the
[shared auto-create dev PR workflow](https://github.com/cyaris/shared-automation#githubworkflowsauto-create-dev-pryml);
after changes are pushed to `dev`, the shared workflow opens a pull request back to the default branch when one does not
already exist.

`.github/workflows/auto-release.yml` is a manual-only wrapper around the
[shared auto-release workflow](https://github.com/cyaris/shared-automation#githubworkflowsauto-releaseyml). It defaults
to report-only reconciliation with `publish=false`; release creation or existing-release updates still require reviewing
the generated plan and explicitly enabling publication for an approved run.

`.github/workflows/workflow-validation.yml` is a thin wrapper around the
[shared workflow-validation workflow](https://github.com/cyaris/shared-automation#githubworkflowsworkflow-validationyml)
and validates this repository's own workflow files with `actionlint` and `zizmor` when they change.

`.github/workflows/deploy.yml` is repository-owned deployment logic, not a shared-automation wrapper. It deploys the
Worker with [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action) on every push to `main`, and
supports manual `workflow_dispatch` restricted to the `cyaris` actor. It requires:

- A `CLOUDFLARE_API_TOKEN` repository secret with permission to edit this Worker.
- A `CLOUDFLARE_ACCOUNT_ID` repository variable.

The workflow fails clearly if either is missing rather than silently skipping the deploy. This workflow only runs
`wrangler deploy`; it does not create the `RESEND_API_KEY` or `TURNSTILE_SECRET_KEY` Worker secrets described in
[Deploy](#deploy), which are configured directly against the Cloudflare account and persist across deploys.
