# TODO

- Add a `CLOUDFLARE_API_TOKEN` repository secret and a `CLOUDFLARE_ACCOUNT_ID` repository variable (Settings ->
  Secrets and variables -> Actions) so `.github/workflows/deploy.yml` can deploy on push to `main`. The workflow
  fails clearly with a missing-configuration error until both are set.
- Update `test/index.spec.js` to test the actual contact-form handler in `src/index.js`. The test file still
  asserts the `wrangler init` "Hello World" boilerplate response and has never been updated since the initial
  commit, so `npm test` currently fails.
