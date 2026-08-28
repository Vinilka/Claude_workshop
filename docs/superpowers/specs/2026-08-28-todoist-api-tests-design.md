# Todoist API Test Suite — Design

**Date:** 2026-08-28
**Status:** Approved
**Target:** Todoist API (the service behind https://app.todoist.com/)

## Purpose

An automated regression suite covering the basic, business-critical task
flows of the Todoist API: creating a task, confirming it lands on the right
calendar date, moving it to another date, completing it, and deleting it.

The suite runs once per day in GitHub Actions on a free account and reports
results without any third-party integration.

Explicitly out of scope, per the requester: footer, navigation menu,
settings screens, account management, and any other non-core surface.

## Verified API facts

These were established by probing the live API with the workshop token on
2026-08-28. They are not assumptions, and several contradict the examples
commonly found online.

| Fact | Detail | Consequence for tests |
|---|---|---|
| REST v2 is retired | `GET /rest/v2/tasks` returns **410 Gone** | The suite must target `https://api.todoist.com/api/v1`. Any tutorial-derived code aimed at v2 fails outright. |
| Delete is a soft delete | After `DELETE /tasks/{id}`, `GET /tasks/{id}` still returns **200** with `is_deleted: true`; the task disappears from list results | "Task is deleted" must be asserted as *absent from the list* (and/or `is_deleted: true`), **never** as a 404. A 404 assertion would fail against correct behaviour. |
| Malformed id is a 400 | `GET /tasks/000000000000000000` returns **400**, not 404 | The negative test asserts 400. |
| Empty content is a 400 | `POST /tasks` with `content: ""` (or with `content` omitted) returns **400** and a structured body: `{error, error_code: 20, error_tag: "INVALID_ARGUMENT_VALUE", http_code}` | The validation test asserts 400 and the `error_tag`, not just any 4xx. |
| Bad token is a 401 | `Authorization: Bearer badtoken` returns **401** | Auth negative test asserts 401. |
| Filters are the calendar | `GET /tasks/filter?query=due: today` returns matching tasks | This is the API-level equivalent of the calendar / Upcoming view. |
| List responses are wrapped | Shape is `{ "results": [...], "next_cursor": null }` | The client unwraps `results`; tests never index a bare array. |
| Updates use POST | `POST /tasks/{id}` with a partial body returns **200** | Not PATCH or PUT. |
| Close/reopen/delete return 204 | Empty body | Assertions check status, then re-read the task to verify state. |

### Endpoint reference

Base URL `https://api.todoist.com/api/v1`, header `Authorization: Bearer <token>`.

- `GET    /tasks` — list → `{results, next_cursor}`
- `POST   /tasks` — create → 200 + task object
- `GET    /tasks/{id}` — read → 200
- `POST   /tasks/{id}` — update (partial body) → 200
- `POST   /tasks/{id}/close` — complete → 204
- `POST   /tasks/{id}/reopen` — uncomplete → 204
- `DELETE /tasks/{id}` — soft delete → 204
- `GET    /tasks/filter?query=<todoist filter>` — the calendar query → `{results}`
- `GET|POST /projects`, `DELETE /projects/{id}` — project lifecycle → 204 on delete

Task fields the suite relies on: `id`, `content`, `description`, `project_id`,
`priority`, `checked`, `is_deleted`, `labels`, and the nested
`due: { date, string, is_recurring, timezone, lang }`.

Note: API `priority` is inverted relative to the UI — `1` is normal and `4`
is urgent. Tests assert the API value.

## Architecture

```
.env                     TODOIST_API_TOKEN — gitignored, never committed
.env.example             committed template
playwright.config.ts
tsconfig.json
package.json
src/
  config.ts              loads and validates env; fails fast with a clear message
  global-teardown.ts     sweeps projects left behind by a killed worker
  utils/
    dates.ts             account-timezone date maths for scheduling assertions
  api/
    types.ts             Task, Project, Due, list-envelope types
    todoist-client.ts    typed wrapper over Playwright's APIRequestContext
  fixtures/
    test-fixtures.ts     authenticated client, per-run project, auto-cleanup
tests/
  task-lifecycle.spec.ts
  task-scheduling.spec.ts
  task-validation.spec.ts
  unit/
    client-smoke.spec.ts
    config.spec.ts
    dates.spec.ts
    fixtures.spec.ts
    pagination.spec.ts
    sweep.spec.ts
reporting/
  summary-reporter.ts    markdown pass/fail table -> GitHub job summary
.github/workflows/daily-api-tests.yml
```

### Component responsibilities

**`src/config.ts`** — reads `TODOIST_API_TOKEN` from the environment (via
`.env` locally, via a GitHub Secret in CI) and throws a readable error naming
the missing variable if it is absent. This is the only place environment
access happens.

**`src/api/todoist-client.ts`** — one method per endpoint above, each
returning parsed, typed data. It owns the base URL and the auth header, so no
spec file ever constructs a raw request. Methods return the raw
`APIResponse` where a test needs to assert a status code (the negative
cases), and parsed objects otherwise.

**`src/fixtures/test-fixtures.ts`** — extends Playwright's `test` with:
- `client` — a `TodoistClient` bound to an authenticated request context.
- `testProject` — a worker-scoped project, created once per worker process
  and deleted in that worker's teardown.
- `trackTask(id)` — registers a task for guaranteed deletion in teardown.

Teardown runs on failure as well as success, so a broken assertion never
leaves rubbish in the account.

**`reporting/summary-reporter.ts`** — a Playwright reporter that collects
per-test outcomes and writes a markdown table. In CI it appends to the file
named by `$GITHUB_STEP_SUMMARY`; locally it prints to the console and writes
`test-results/summary.md`. No network calls, no third-party service.

## Test isolation

The suite runs against a real, shared account, so isolation is a design
constraint rather than an afterthought.

1. **Assert on our own task, never on totals.** Filter queries such as
   `due: today` are account-wide. A test asserting "the today filter contains
   exactly one task" breaks as soon as a second test runs in parallel. Every
   assertion instead checks that a *specific task id* is present in, or
   absent from, the returned results.
2. **One project per worker, not per test.** The free plan caps active
   projects, so a project-per-test design would hit that limit under
   parallelism. The project fixture is worker-scoped: each worker process
   creates one project in setup and deletes it in teardown, which removes
   any tasks still inside it.
3. **Unique content per run.** Task content carries a short run id, so any
   leftovers from a crashed run are identifiable and distinguishable from a
   live run's data. Project names carry it too.
4. **Cleanup in teardown, not at the end of the test body.** A failed
   assertion aborts the test body; teardown still runs.

## Scenarios

### task-lifecycle.spec.ts
- Create a task with content and description; response echoes both.
- Read the task back by id.
- Update the task's content; the change persists on re-read.
- Complete the task (`close`); re-read shows `checked: true`.
- Reopen the task; re-read shows `checked: false`.
- Delete the task; it is absent from the task list and reports
  `is_deleted: true`.

### task-scheduling.spec.ts
- Create a task due today (`due_string: "today"`); it appears in the
  `due: today` filter, and `due.date` equals today's date in the account
  timezone. *(The calendar check.)*
- Create a task due tomorrow; it appears in `due: tomorrow` and is absent
  from `due: today`.
- **Move a task to another date:** create it due today, update it to
  tomorrow, then confirm it has left the today filter and entered the
  tomorrow filter. *(The move-to-another-date scenario.)*
- Create a task with a priority; the priority persists.
- Create a recurring task (`every day`); `due.is_recurring` is `true`.

### task-validation.spec.ts
- A request with an invalid token returns 401.
- Creating a task with empty content returns 400 with error tag
  `INVALID_ARGUMENT_VALUE`.
- Requesting a malformed task id returns 400.

Nineteen business-scenario tests in total, plus thirty-two supporting unit
tests covering config loading, client connectivity, the date helper, fixture
cleanup, pagination cursor-following, and stale-project sweep logic — fifty-one
altogether, across 9 spec files. (`pagination.spec.ts` and `sweep.spec.ts`
were added after this document was first written.)

## Dates and timezone

The test account is set to `Europe/Prague` (`+02:00`, DST active), confirmed
via `GET /api/v1/user` → `tz_info.timezone`. GitHub Actions runners are UTC.
Naive client-side date arithmetic would therefore disagree with Todoist's
notion of "today" for part of every day, producing a suite that fails at
some hours and passes at others.

Two rules remove the problem:

1. **Let the server resolve relative dates.** Create tasks with
   `due_string: "today"` / `"tomorrow"` and query them with
   `due: today` / `due: tomorrow`. Both sides are resolved by Todoist in the
   account's timezone, so they agree by construction regardless of where the
   runner sits.
2. **Where a test needs a literal date**, compute it in the account's
   timezone — `Intl.DateTimeFormat('en-CA', { timeZone })` yields the
   `YYYY-MM-DD` form the API uses — with `timeZone` read from `/user` at
   setup rather than hardcoded. If the account timezone changes, the suite
   follows it instead of breaking.

The daily cron is set to `0 6 * * *` UTC, which is 08:00 in Prague and
comfortably inside the same calendar day in both zones.

## Reporting

Two outputs, no integrations:

1. **GitHub Actions job summary** — a markdown table of passed, failed and
   skipped tests with durations, rendered directly on the run page. Nothing
   to download and nothing to log into.
2. **Playwright HTML report** — uploaded as a workflow artifact for the run,
   available when a failure needs investigating.

The step that publishes the summary runs with `if: always()`, so a failing
run still reports.

## CI

`.github/workflows/daily-api-tests.yml`:

- Triggers: `schedule` at cron `0 6 * * *` (daily), plus `workflow_dispatch`
  for manual runs during the workshop.
- Runs on `ubuntu-latest`, Node 20 LTS, `npm ci`.
- **No browser download.** The suite is API-only, so Playwright browsers are
  never installed and a run completes in seconds — comfortably inside a free
  account's allowance, and unlimited on a public repository.
- The token is read from the `TODOIST_API_TOKEN` repository secret.

## Security

The API token is supplied through `.env` locally and a GitHub Secret in CI.
`.env` is gitignored before any token is written to disk, so the secret
cannot reach the repository history. `.env.example` documents the variable
name with a placeholder value.

The token used to build this suite was shared in plain text and should be
rotated in Todoist settings once the workshop is over.

## Out of scope

UI/browser testing, load and performance testing, the Sync API, webhooks,
collaboration and sharing, labels and filters management as features in
their own right, and every surface named as excluded above.
