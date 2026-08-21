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
|---|---|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in `wrangler.jsonc`.

## JavaScript

- Follow the JavaScript-relevant formatting, dependency-ownership, and single-use guidance from
  `../svelte-lib/AGENTS.md` for source, test, and config JavaScript, including `.js`, `.mjs`, and JavaScript embedded in
  HTML. Repository-local rules override that sibling guidance, including tab indentation and the 140-character print
  width. Svelte component, embedded-app, package-export, and library-release rules do not apply to this plain Worker.
