# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Retrieve current documentation before any
Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, Workers AI, or Agents SDK task.

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

Command | Purpose
--- | ---
`npx wrangler dev` | Local development
`npx wrangler deploy` | Deploy to Cloudflare
`npx wrangler types` | Generate TypeScript types

Run `wrangler types` after changing bindings in `wrangler.jsonc`.

## Contact Worker Isolation

- Keep `contact-form-worker` for Charlie Yaris and `fantasy-playtime-contact-worker` for Fantasy Playtime as separate
  deployments with separate entrypoints, Wrangler files, sender identities, Turnstile widgets, and secrets. Shared
  validation, CORS, Turnstile, escaping, and Resend behavior belongs in `src/contact.js`.
- Keep Fantasy Playtime's production endpoint at `https://contact-api.fantasyplaytime.com` and its production CORS and
  Turnstile hostname allowlists restricted to the frontend hostnames that are actually served. Never use wildcard
  production CORS or admit development origins in production.
- Treat Turnstile site keys as public configuration, and real Turnstile secrets and Resend API keys as Worker secrets
  under the shared secrets rule, never placed in Wrangler variables. Cloudflare's official Turnstile test secrets may
  appear in local-development fixtures such as `.dev.vars.example`. Fantasy Playtime uses `TURNSTILE_SECRET` and an
  independently scoped `RESEND_API_KEY`, and Charlie Yaris retains its existing binding names.
- Verify Turnstile server-side before sending mail, safely validate and escape user-provided content, keep provider
  responses and stack traces out of client responses and logs, and keep local origins out of production configuration.

## JavaScript

The workspace JavaScript rules apply to source, test, and config JavaScript, including `.js`, `.mjs`, and JavaScript
embedded in HTML. Repository-local rules override it, including tab indentation and the 140-character print width.
