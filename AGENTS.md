# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Retrieve current documentation before any
Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, Workers AI, or Agents SDK task.

## Shared Conventions

- Inherit README and Markdown style, GitHub Actions, reusable workflow, pull-request review, workflow failure, commit,
  and release-management rules from `../shared-automation/AGENTS.md`.

## Current Documentation

- Workers: https://developers.cloudflare.com/workers/
- Documentation MCP: `https://docs.mcp.cloudflare.com/mcp`
- Node.js compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Error reference: https://developers.cloudflare.com/workers/observability/errors/
- Product references: `/kv/`, `/r2/`, `/d1/`, `/durable-objects/`, `/queues/`, `/vectorize/`, `/workers-ai/`, and
  `/agents/`

Retrieve limits and quotas from the product's current `/platform/limits/` page, such as
`/workers/platform/limits/`. For Error 1102, retrieve the current Workers CPU and memory limits before diagnosing it.

If the application uses Durable Objects or Workflows, also retrieve their current best-practice rules:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/

## Commands

| Command | Purpose |
| --- | --- |
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in `wrangler.jsonc`.

## Contact Worker Isolation

- Keep `contact-form-worker` for Charlie Yaris and `fantasy-playtime-contact-worker` for Fantasy Playtime as separate
  deployments with separate entrypoints, Wrangler files, sender identities, Turnstile widgets, and secrets. Shared
  validation, CORS, Turnstile, escaping, and Resend behavior belongs in `src/contact.js`.
- Keep Fantasy Playtime's production endpoint at `https://contact-api.fantasyplaytime.com` and its production CORS and
  Turnstile hostname allowlists restricted to the frontend hostnames that are actually served. Never use wildcard
  production CORS or admit development origins in production.
- Treat Turnstile site keys as public frontend configuration. Treat real Turnstile secrets and Resend API keys as private
  Worker secrets: never commit, print, log, fixture, or place them in Wrangler variables. Cloudflare's official Turnstile
  test secrets are the one exception and may appear in local-development fixtures such as `.dev.vars.example`. Fantasy
  Playtime uses `TURNSTILE_SECRET` and an independently scoped `RESEND_API_KEY`; Charlie Yaris retains its existing
  binding names.
- Verify Turnstile server-side before sending mail, safely validate and escape user-provided content, and keep provider
  responses, secrets, and stack traces out of client responses and logs. Official Turnstile test credentials and local
  origins must never reach production configuration.

## JavaScript

Follow the JavaScript-relevant formatting, dependency-ownership, and single-use guidance from `../svelte-lib/AGENTS.md`
for source, test, and config JavaScript, including `.js`, `.mjs`, and JavaScript embedded in HTML. Repository-local rules
override that sibling guidance, including tab indentation and the 140-character print width. Svelte component,
embedded-app, package-export, and library-release rules do not apply to this plain Worker.
