# Todoist API Tests

Automated API tests for the core Todoist task flows, written with Playwright.
The suite creates a task, checks that it lands on the right calendar date,
moves it to another date, completes it, and deletes it — then cleans up after
itself.

## What is covered

| Spec | Scenarios |
|---|---|
| `tests/task-lifecycle.spec.ts` | Create, read, list, update, complete, reopen, delete |
| `tests/task-scheduling.spec.ts` | Due today, due tomorrow, move between dates, clear a date, priority, recurrence |
| `tests/task-validation.spec.ts` | Invalid token, missing token, empty/missing content, malformed id, out-of-range priority (verifies it is clamped, not rejected) |
| `tests/unit/` | Config loading, client connectivity, timezone date maths, fixture cleanup, pagination cursor-following, stale-project sweep logic |

Out of scope by design: the UI, navigation, settings, and account management.

## Setup

```bash
npm install
cp .env.example .env    # then paste your token into .env
npm test
```

Get a token from Todoist → Settings → Integrations → Developer → API token.
No browser download is needed — the suite never opens one.

`TODOIST_BASE_URL` is optional and overrides the API host; it defaults to
`https://api.todoist.com`.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run the whole suite |
| `npm run test:lifecycle` | Lifecycle scenarios only |
| `npm run test:scheduling` | Scheduling and calendar scenarios only |
| `npm run test:validation` | Validation scenarios only |
| `npm run report` | Open the HTML report from the last run |
| `npm run typecheck` | Type-check without emitting |

## Reporting

Every run writes `test-results/summary.md`, a markdown table of results. In
GitHub Actions the same table is appended to the job summary, so results are
visible on the run page without downloading anything. The full HTML report is
attached to each run as an artifact, kept for 14 days.

## Continuous integration

`.github/workflows/daily-api-tests.yml` runs the suite daily at 06:00 UTC
(08:00 Europe/Prague), on every push to `main`, and on demand via the **Run
workflow** button on the Actions tab.

It needs one repository secret: **`TODOIST_API_TOKEN`**, added under
Settings → Secrets and variables → Actions.

## How the tests stay isolated

The suite runs against a real account, so isolation is deliberate:

- Assertions check **a specific task id**, never a result count — filters such
  as `due: today` are account-wide and shared with parallel tests.
- Each worker creates **one project** and deletes it in teardown, which keeps
  the account inside the free plan's project limit.
- Cleanup lives in fixture teardown, so it runs even when a test fails.
- A global teardown sweeps any project left behind by a killed worker.

## Notes on the API

- The base URL is `https://api.todoist.com/api/v1`. The older `/rest/v2` API
  is retired and returns **410 Gone**.
- Deleting a task is a **soft delete**: the id still resolves with 200 and
  `is_deleted: true`, and the task leaves list results. Tests assert absence
  from the list, not a 404.
- `priority` is inverted relative to the UI: `1` is normal, `4` is urgent.
- Relative dates are resolved by Todoist in the account timezone
  (`Europe/Prague`), so tests use `due_string` and filter queries rather than
  computing dates on the runner.

## Security

The API token lives in `.env` locally, which is gitignored, and in a GitHub
Actions secret in CI. It is never committed.
