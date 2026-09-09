# Charlie Yaris Workers

Cloudflare Workers for the `charlieyaris.com` and `fantasyplaytime.com` contact forms.

For contact-form `POST` requests from allowed site origins, the Worker:

- validates the Turnstile token
- sends the message through Resend
- attempts a confirmation email to the visitor

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/contact.js` | Shared validation, CORS, Turnstile, Resend, and response implementation |
| `src/fantasy-playtime.js` | Fantasy Playtime product configuration and entrypoint |
| `src/index.js` | Charlie Yaris product configuration and entrypoint |
| `test/index.spec.js` | Vitest test file |
| `wrangler.fantasy-playtime.dev.jsonc` | Local-only Fantasy Playtime Worker configuration |
| `wrangler.fantasy-playtime.jsonc` | Fantasy Playtime production deployment configuration |
| `wrangler.jsonc` | Charlie Yaris production deployment configuration |

## Requirements

- Node.js and npm
- A Cloudflare account with Workers access
- A dedicated Resend API key for each verified sending domain
- A dedicated Cloudflare Turnstile secret key for each site

## Install

```bash
npm install
```

## Configuration

Each production Wrangler file configures an independent Worker name and sender identity. `wrangler.jsonc` retains the
existing `contact-form-worker` deployment. `wrangler.fantasy-playtime.jsonc` configures
`fantasy-playtime-contact-worker`, disables its `workers.dev` endpoint, and declaratively attaches only
`contact-api.fantasyplaytime.com` as a Custom Domain.

Current production variables:

- `CONTACT_FROM_EMAIL` - sender address shown on outgoing emails
- `CONTACT_TO_EMAIL` - inbox that receives contact-form messages

Both deployments require `RESEND_API_KEY`. Charlie Yaris retains `TURNSTILE_SECRET_KEY`; Fantasy Playtime deliberately
uses the isolated secret name `TURNSTILE_SECRET`. Secret values never belong in Wrangler files, fixtures, logs, or Git.

- Charlie Yaris: `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY`
- Fantasy Playtime: `RESEND_API_KEY` and `TURNSTILE_SECRET`

For local development, copy `.dev.vars.example` to `.dev.vars`. The committed Turnstile values are Cloudflare's
official always-pass test secret under each product's binding name, not production credentials. Supply a development
Resend key only when intentionally testing real email delivery.

```bash
cp .dev.vars.example .dev.vars
```

Do not commit `.dev.vars` or `.env` files.

## Local Development

Start the Charlie Yaris Worker locally:

```bash
npm run dev
```

Wrangler will print the local URL, usually `http://localhost:8787`.

Start the Fantasy Playtime Worker locally with its separate development configuration:

```bash
npm run dev:fantasy-playtime
```

The Fantasy development configuration admits only `http://localhost:3000` and `http://127.0.0.1:3000`, matching the
app's Vite server. Production ignores those origins and accepts only `https://fantasyplaytime.com`. Automated tests mock
Turnstile and Resend and never send real email.

## Deploy

Authenticate Wrangler with Cloudflare:

```bash
npx wrangler login
```

Confirm Wrangler is using the expected Cloudflare account:

```bash
npx wrangler whoami
```

Create the Charlie Yaris production secrets. Each command prompts for the secret value:

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

This runs `wrangler deploy` using `wrangler.jsonc`. The configuration names the Worker `contact-form-worker` and sets
`workers_dev` to `true`, so Cloudflare publishes it to the account's `workers.dev` subdomain. Adding routes or a custom
domain does not disable that endpoint while `workers_dev` is `true`; set `workers_dev` to `false` to remove it.

Pushes to `main` also deploy automatically through `.github/workflows/deploy.yml`; see
[GitHub Actions Workflows](#github-actions-workflows) for the required repository secret and variable.

The existing workflow intentionally remains scoped to Charlie Yaris. After reviewing the Fantasy Playtime code, create
its isolated Worker and Custom Domain from this repository root:

```bash
npx wrangler deploy --config wrangler.fantasy-playtime.jsonc
```

The first deployment creates `fantasy-playtime-contact-worker` and attaches the declarative Custom Domain. Then enter
the two Fantasy Playtime secrets interactively; never place their values on the command line:

```bash
npx wrangler secret put TURNSTILE_SECRET --config wrangler.fantasy-playtime.jsonc
npx wrangler secret put RESEND_API_KEY --config wrangler.fantasy-playtime.jsonc
```

If the Custom Domain cannot be attached because the hostname already has a DNS record, inspect that record rather than
deleting it automatically. After resolving the conflict deliberately, rerun the same deploy command or attach
`contact-api.fantasyplaytime.com` under the Worker's **Settings > Domains & Routes** page.

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run deploy` | Deploy the Charlie Yaris Worker |
| `npm run deploy:fantasy-playtime` | Deploy the Fantasy Playtime Worker and Custom Domain |
| `npm run dev` | Start the Charlie Yaris Worker locally |
| `npm run dev:fantasy-playtime` | Start the Fantasy Playtime Worker locally |
| `npm run format` | Format project files |
| `npm test` | Run Vitest |

## Production Checklist

Before deploying either product, verify:

- `CONTACT_FROM_EMAIL` uses a Resend-verified sending domain.
- `CONTACT_TO_EMAIL` points to the destination inbox.
- The product's dedicated `RESEND_API_KEY` is set as a Worker secret.
- The product's dedicated Turnstile secret is set under its documented binding name.
- The product-specific entrypoint contains the exact production frontend origin and Turnstile hostname.

For Fantasy Playtime, also verify:

- `contact-api.fantasyplaytime.com` resolves to `fantasy-playtime-contact-worker` as a Custom Domain.
- `fantasyplaytime.com` is fully verified in Resend.
- The Resend key is restricted to the Fantasy Playtime sending domain where supported.
- The sender is `Fantasy Playtime <contact@fantasyplaytime.com>`.

## GitHub Actions Workflows

These local wrappers inherit their reusable implementations from `cyaris/shared-automation`. The
[shared-automation workflow reference](https://github.com/cyaris/shared-automation#workflows) documents shared
behavior, inputs, and secrets.

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

`.github/workflows/ci.yml` runs `npm test` and `npm run format:check` on pushes to `dev` and `main`, and supports manual
dispatch. The repository has no build, type-check, or lint script, so those shared CI steps are explicitly disabled.

`.github/workflows/deploy.yml` is repository-owned deployment logic, not a shared-automation wrapper. It deploys only
the Charlie Yaris Worker with [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action) on every
push to `main`, and supports manual `workflow_dispatch` restricted to the `cyaris` actor. Tests and formatting must pass
in the deployment workflow before Wrangler runs. It requires:

- A `CLOUDFLARE_API_TOKEN` repository secret with permission to edit this Worker.
- A `CLOUDFLARE_ACCOUNT_ID` repository variable.

The workflow fails clearly if either is missing rather than silently skipping the deploy. It does not deploy the
Fantasy Playtime Worker or create any Worker secrets. Configure the Charlie Yaris secrets directly in the Cloudflare
account; they persist across deploys. Deploy Fantasy Playtime manually with the reviewed command in [Deploy](#deploy),
then configure its separately scoped `RESEND_API_KEY` and `TURNSTILE_SECRET` secrets.

First-party reusable workflow references intentionally track `cyaris/shared-automation@main`. This repository and the
shared workflow repository have the same owner, so following the production branch keeps fixes current without granting
an external maintainer control over CI or deployment code.
