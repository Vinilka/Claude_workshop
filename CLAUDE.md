# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working agreements

- **English only** — all code, comments, commit messages, docs, and communication.
- **Branch per feature.** Create the branch before writing code; never work directly on `main`.
- **Never merge into `main` and never push.** Not to any remote, not even when asked to "finish" or "wrap up" — integration is the user's call alone. Do not commit either; the user does that.
- When a feature is finished, fetch and report how the branch stands against `origin/main` (ahead/behind, any conflicts), then hand it back.
- **A pull request per feature.** Every feature branch ends with a PR — but the PR is *prepared*, not opened: write out the title and the bullet description in the handover so the user can paste them straight into GitHub. The user commits, pushes and opens the PR.
- **Worktrees are the exception, not the default.** Work in the main worktree unless more than one agent is running in parallel; when a worktree is used, bring the work back into the main worktree.
- **PR format** — a clear, specific title and a description written as bullet points (what changed and why). No mention of Claude, Claude Code, or any AI attribution, and no generated-by footer.

## What this is

A Playwright **API-only** test suite for the Todoist API (`https://api.todoist.com/api/v1`). No browser is ever launched, so `playwright install` is never needed. Tests run against a **real Todoist account on the free plan** using a token from `.env`, which shapes most of the design decisions below.

## Commands

```bash
npm test                       # whole suite (live + unit)
npm run test:lifecycle         # one spec file
npm run typecheck              # tsc --noEmit (there is no linter)
npm run report                 # open the HTML report from the last run

npx playwright test tests/unit --grep-invert @live  # offline specs only — no network, no token needed
npx playwright test tests/unit                    # all of tests/unit — the @live specs need a token
npx playwright test tests/unit/dates.spec.ts      # a single file
npx playwright test -g "moves a task to tomorrow" # a single test by title
```

Setup: `npm install`, then `cp .env.example .env` and paste a Todoist API token (Todoist → Settings → Integrations → Developer). `TODOIST_BASE_URL` optionally overrides the host.

## Architecture

- [src/config.ts](src/config.ts) — the **only** place that reads `process.env`. Owns `API_PREFIX`, `TEST_PROJECT_PREFIX`, and `runId`. `loadConfig(env)` takes an env object so it is unit-testable.
- [src/api/todoist-client.ts](src/api/todoist-client.ts) — typed wrapper over Playwright's `APIRequestContext`. **Every Todoist path lives here**; specs never build a raw request except the deliberate no-token/bad-token cases in the validation spec. Methods throw on unexpected status; the `*Raw` methods return the untouched response for negative tests. `fetchAllPages` takes an injected page-fetcher so pagination is unit-testable without a live account, and throws (rather than truncating) past `MAX_PAGES`.
- [src/fixtures/test-fixtures.ts](src/fixtures/test-fixtures.ts) — the `test` object specs import instead of `@playwright/test`. Worker-scoped: `client`, `testProject`, `accountTimeZone`. Test-scoped: `trackTask`, `uniqueContent`.
- [src/global-teardown.ts](src/global-teardown.ts) + [src/utils/sweep.ts](src/utils/sweep.ts) — sweeps projects stranded by a killed worker. `shouldSweepProject` is pure and unit-tested.
- [reporting/summary-reporter.ts](reporting/summary-reporter.ts) — custom reporter writing `test-results/summary.md`, also appended to `$GITHUB_STEP_SUMMARY` in CI.
- [tests/unit/](tests/unit/) — mostly pure logic tests using bare `@playwright/test`, no fixtures and no network. Two exceptions, `client-smoke.spec.ts` and `fixtures.spec.ts`, exercise the client and the fixtures against the real account and are tagged **`@live`** in their describe titles; `--grep-invert @live` is what CI uses to get a genuinely offline, token-free run. They live under the same `testDir`, so `npm test` runs them alongside the live specs.

## Isolation model (do not break these)

The account is shared and real, so:

- **Assert on a specific task id, never on a count.** Filter queries like `due: today` are account-wide and see other workers' tasks. Use `client.filterContainsTask(query, id)`.
- **One project per worker**, not per test — the free plan caps active projects at 5. `workers` is pinned in [playwright.config.ts](playwright.config.ts) (3 local, 2 CI) for the same reason; do not remove the cap or let it default to core count.
- **Cleanup belongs in fixture teardown** (`trackTask`, `testProject`), not at the end of a test body — a failed assertion aborts the body but teardown still runs.
- `runId` is stamped into `process.env` in `playwright.config.ts` *before* workers fork, using `??=` so re-evaluation in a worker does not overwrite the inherited value. Project names are `${TEST_PROJECT_PREFIX}-${runId}-w${workerIndex}`, and the sweep matches the exact `-${runId}-` segment because CI run ids are variable-length prefixes of each other.
- CI uses `concurrency` without `cancel-in-progress`: cancelling mid-run would skip teardown and strand a project. Both workflows' account-touching jobs share the group `todoist-live-api`, so a pull request's live run and the daily run queue instead of overlapping (2 workers each would be 4 of the 5 allowed projects). The offline job in [.github/workflows/pr-checks.yml](.github/workflows/pr-checks.yml) sits in its own per-ref group and *is* cancellable — it touches no account.

## Todoist API facts that contradict common examples

These were verified against the live API; several tutorials online are wrong.

- `/rest/v2` is **retired → 410 Gone**. Always `/api/v1`.
- **Delete is a soft delete.** `GET /tasks/{id}` still returns 200 with `is_deleted: true` afterwards. Assert *absence from the list*, never a 404.
- **Updates use `POST /tasks/{id}`** with a partial body — not PATCH or PUT.
- Close, reopen, and delete return **204** with no body; re-read the task to verify state.
- List endpoints wrap payloads in `{ results, next_cursor }`.
- A malformed task id is **400**, not 404. Empty/missing `content` is 400 with `error_tag: "INVALID_ARGUMENT_VALUE"`. An out-of-range `priority` is **clamped, not rejected**.
- `priority` is inverted vs. the UI: `1` normal … `4` urgent.
- **Relative dates are resolved by Todoist in the account timezone.** Use `due_string` (`"today"`, `"tomorrow"`) and filter queries rather than computing dates on the runner. When a spec must assert a concrete `due.date`, use `dateInTimeZone(offset, accountTimeZone)` from [src/utils/dates.ts](src/utils/dates.ts), which reduces to a calendar date in the zone *before* shifting days.

## Background docs

[docs/superpowers/specs/](docs/superpowers/specs/) holds the approved design (including the full verified-API-facts table and endpoint reference); [docs/superpowers/plans/](docs/superpowers/plans/) holds the implementation plan.

`Claude_workshop/` is a stray embedded bare git dir, gitignored — leave it alone.
