# Todoist API Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Playwright-based API test suite covering the core Todoist task flows — create, schedule, move to another date, complete, delete — that runs daily in GitHub Actions and reports results with no third-party integration.

**Architecture:** A thin typed client wraps Playwright's `APIRequestContext` and owns the base URL and auth header, so no spec file builds a raw request. Playwright fixtures supply an authenticated client, a worker-scoped throwaway project, and task tracking whose teardown runs even when a test fails. Spec files contain assertions only.

**Tech Stack:** TypeScript, `@playwright/test` (API testing via the `request` fixture — no browsers), `dotenv`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-28-todoist-api-tests-design.md`

## Global Constraints

- **API base URL is `https://api.todoist.com`, with every path prefixed `/api/v1`.** The `/rest/v2` API is retired and returns **410 Gone**. Never write a `/rest/v2` path.
- **Playwright `baseURL` is `https://api.todoist.com` — host only, no path.** Playwright resolves `baseURL` with `new URL()` semantics, so a `baseURL` ending in `/api/v1` without a trailing slash silently drops the last segment. The prefix belongs in the client, not the baseURL.
- **Never assert 404 after deleting a task.** Delete is a soft delete: a subsequent `GET /api/v1/tasks/{id}` returns **200** with `is_deleted: true`, and the task disappears from list results. Assert absence from the list and/or `is_deleted === true`.
- **Never assert on result counts or totals from a filter query.** Filters such as `due: today` are account-wide. Assert only that a specific task id is present or absent.
- **Task updates use `POST /api/v1/tasks/{id}`** with a partial body — not PATCH, not PUT.
- **API `priority` is inverted relative to the UI:** `1` is normal, `4` is urgent. Assert API values.
- **Relative dates are resolved server-side.** Create with `due_string: "today"` / `"tomorrow"` and query with `due: today` / `due: tomorrow`. The account is `Europe/Prague`; CI runners are UTC. Only compute a literal date through the account timezone helper from Task 3.
- **The API token must never reach a commit.** `.gitignore` is written before `.env` exists.
- **The repository owner commits manually.** No task in this plan runs `git commit`. Each task ends with a verification checkpoint and a suggested commit message instead.
- **List responses are wrapped:** `{ "results": [...], "next_cursor": null }`. Never index a bare array.
- Node 20+. All source is TypeScript. All test names, comments, and documentation are in English.

---

### Task 1: Scaffolding, secret hygiene, and config

**Files:**
- Create: `.gitignore`
- Create: `.env`
- Create: `.env.example`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `playwright.config.ts`
- Create: `src/config.ts`
- Test: `tests/unit/config.spec.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): TestConfig` where `TestConfig = { apiToken: string; baseUrl: string }`, exported from `src/config.ts`. Also exports `const API_PREFIX = '/api/v1'`.

- [ ] **Step 1: Write `.gitignore` FIRST, before any file containing the token exists**

This ordering is the whole point of the step. Create `.gitignore`:

```gitignore
node_modules/
.env
.env.local
playwright-report/
test-results/
blob-report/
.DS_Store
*.log
```

- [ ] **Step 2: Verify git will ignore the env file before writing the token**

Run: `git check-ignore -v .env`
Expected: output naming `.gitignore:2` as the matching rule. If this prints nothing, **stop** — the token would be committable.

- [ ] **Step 3: Create `.env` with the real token, and `.env.example` with a placeholder**

`.env` — **the real token is deliberately absent from this plan**, because this
document is committed and `.env` is not. Take the token from whoever owns the
account, or from Todoist → Settings → Integrations → Developer:

```dotenv
TODOIST_API_TOKEN=<paste the real token here, no quotes, no trailing spaces>
```

If `.env` already exists with a valid token, leave it alone and move on.

`.env.example`:

```dotenv
# Todoist API token — Todoist → Settings → Integrations → Developer → API token
TODOIST_API_TOKEN=your_todoist_api_token_here
```

- [ ] **Step 4: Confirm the token is invisible to git**

Run: `git status --porcelain | grep -c "\.env$"`
Expected: `0` — `.env` does not appear as an untracked file. `.env.example` may appear; that is correct.

- [ ] **Step 5: Create `package.json`**

```json
{
  "name": "todoist-api-tests",
  "version": "1.0.0",
  "private": true,
  "description": "Playwright API test suite for the Todoist API",
  "scripts": {
    "test": "playwright test",
    "test:lifecycle": "playwright test tests/task-lifecycle.spec.ts",
    "test:scheduling": "playwright test tests/task-scheduling.spec.ts",
    "test:validation": "playwright test tests/task-validation.spec.ts",
    "report": "playwright show-report",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.0",
    "@types/node": "^22.10.0",
    "dotenv": "^16.4.7",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 6: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "reporting", "playwright.config.ts"]
}
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: completes and creates `package-lock.json`. Do **not** run `npx playwright install` — this suite makes no browser calls and installing browsers would waste CI minutes.

- [ ] **Step 8: Write the failing test for config**

Create `tests/unit/config.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loadConfig, API_PREFIX } from '../../src/config';

test.describe('loadConfig', () => {
  test('returns the token and default base URL when the token is set', () => {
    const config = loadConfig({ TODOIST_API_TOKEN: 'abc123' });

    expect(config.apiToken).toBe('abc123');
    expect(config.baseUrl).toBe('https://api.todoist.com');
  });

  test('trims surrounding whitespace from the token', () => {
    const config = loadConfig({ TODOIST_API_TOKEN: '  abc123  ' });

    expect(config.apiToken).toBe('abc123');
  });

  test('throws a named, actionable error when the token is missing', () => {
    expect(() => loadConfig({})).toThrow(/TODOIST_API_TOKEN/);
  });

  test('throws when the token is present but empty', () => {
    expect(() => loadConfig({ TODOIST_API_TOKEN: '   ' })).toThrow(/TODOIST_API_TOKEN/);
  });

  test('allows the base URL to be overridden', () => {
    const config = loadConfig({
      TODOIST_API_TOKEN: 'abc123',
      TODOIST_BASE_URL: 'https://staging.todoist.com',
    });

    expect(config.baseUrl).toBe('https://staging.todoist.com');
  });

  test('exposes the versioned API prefix', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });
});
```

- [ ] **Step 9: Create `playwright.config.ts`**

Note: this file deliberately does **not** call `loadConfig()`. Calling it here would abort the whole run before the config tests above could execute, and would break `playwright test --list` on a machine without a token. Validation happens lazily inside the client fixture.

```typescript
import { defineConfig } from '@playwright/test';

// Stamp one run id into the environment of the main process before workers are
// forked. Worker processes inherit this value, so every worker in a run shares
// it; the `??=` prevents a worker from overwriting the inherited value when it
// re-evaluates this config file.
process.env.TODOIST_TEST_RUN_ID ??= Date.now().toString(36);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Capped in CI: each worker creates its own project, and the free Todoist
  // plan limits how many active projects an account may hold.
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalTeardown: './src/global-teardown.ts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./reporting/summary-reporter.ts'],
  ],
  use: {
    // Host only. A baseURL ending in `/api/v1` would lose its last path
    // segment when Playwright resolves relative paths via `new URL()`.
    baseURL: 'https://api.todoist.com',
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
    trace: 'off',
  },
});
```

- [ ] **Step 10: Run the config tests to verify they fail**

Run: `npx playwright test tests/unit/config.spec.ts --reporter=list`
Expected: FAIL — `Cannot find module '../../src/config'`.

The `globalTeardown` and summary reporter referenced in the config do not exist yet either. If Playwright errors on those before reaching the tests, create both as temporary no-op stubs so this task can be verified, and replace them fully in Tasks 4 and 8:

```typescript
// src/global-teardown.ts — replaced in Task 4
export default async function globalTeardown(): Promise<void> {}
```

```typescript
// reporting/summary-reporter.ts — replaced in Task 8
import type { Reporter } from '@playwright/test/reporter';
export default class SummaryReporter implements Reporter {}
```

- [ ] **Step 11: Implement `src/config.ts`**

```typescript
import 'dotenv/config';

/** Version prefix for every Todoist API path. The `/rest/v2` API is retired. */
export const API_PREFIX = '/api/v1';

export interface TestConfig {
  apiToken: string;
  baseUrl: string;
}

/**
 * Reads and validates the environment the suite needs.
 *
 * This is the only place in the suite that touches the environment, so a
 * missing token produces one clear error instead of an opaque 401 from
 * whichever request happened to run first.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): TestConfig {
  const apiToken = env.TODOIST_API_TOKEN?.trim();

  if (!apiToken) {
    throw new Error(
      'TODOIST_API_TOKEN is not set.\n' +
        '  Locally: copy .env.example to .env and add your token ' +
        '(Todoist → Settings → Integrations → Developer → API token).\n' +
        '  In CI: add TODOIST_API_TOKEN as a repository secret.',
    );
  }

  return {
    apiToken,
    baseUrl: env.TODOIST_BASE_URL?.trim() || 'https://api.todoist.com',
  };
}
```

- [ ] **Step 12: Run the config tests to verify they pass**

Run: `npx playwright test tests/unit/config.spec.ts --reporter=list`
Expected: PASS — 6 passed.

- [ ] **Step 13: Verify types compile**

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 14: Checkpoint**

The project builds, config is validated and tested, and the token is on disk but unreachable by git. Suggested commit message when you commit:

```
chore: scaffold Playwright API test project with validated config
```

---

### Task 2: Types and the Todoist API client

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/todoist-client.ts`
- Test: `tests/unit/client-smoke.spec.ts`

**Interfaces:**
- Consumes: `loadConfig`, `API_PREFIX` from `src/config.ts` (Task 1).
- Produces: `class TodoistClient` with the exact methods listed in Step 3 below, and the types `TodoistTask`, `TodoistProject`, `TodoistDue`, `TodoistUser`, `ListEnvelope<T>`, `CreateTaskInput`, `UpdateTaskInput` from `src/api/types.ts`. Tasks 4–7 depend on these names.

- [ ] **Step 1: Create `src/api/types.ts`**

Field names are copied from live API responses recorded in the spec's endpoint reference. Do not rename them.

```typescript
/** A task's due date. Null on a task with no date. */
export interface TodoistDue {
  date: string;
  timezone: string | null;
  string: string;
  lang: string;
  is_recurring: boolean;
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  labels: string[];
  /** 1 = normal … 4 = urgent. Inverted relative to the Todoist UI. */
  priority: number;
  /** True once the task is completed. */
  checked: boolean;
  /** True after a soft delete. The task still resolves by id. */
  is_deleted: boolean;
  due: TodoistDue | null;
  added_at: string;
  completed_at: string | null;
}

export interface TodoistProject {
  id: string;
  name: string;
  is_deleted: boolean;
  is_archived: boolean;
  inbox_project?: boolean;
}

export interface TodoistUser {
  id: string;
  tz_info: {
    timezone: string;
    gmt_string: string;
    is_dst: number;
  };
}

/** Every Todoist list endpoint wraps its payload in this envelope. */
export interface ListEnvelope<T> {
  results: T[];
  next_cursor: string | null;
}

export interface CreateTaskInput {
  content: string;
  description?: string;
  project_id?: string;
  /** Natural-language date resolved by Todoist in the account timezone. */
  due_string?: string;
  priority?: number;
  labels?: string[];
}

export interface UpdateTaskInput {
  content?: string;
  description?: string;
  due_string?: string;
  priority?: number;
  labels?: string[];
}

/** Error body returned by a rejected request. */
export interface TodoistErrorBody {
  error: string;
  error_code: number;
  error_tag: string;
  http_code: number;
}
```

- [ ] **Step 2: Write the failing smoke test**

Create `tests/unit/client-smoke.spec.ts`. This test hits the live API, so it proves auth, base URL, and envelope unwrapping all work together before any scenario depends on them.

```typescript
import { test, expect, request } from '@playwright/test';
import { TodoistClient } from '../../src/api/todoist-client';
import { loadConfig } from '../../src/config';

test.describe('TodoistClient connectivity', () => {
  test('authenticates and unwraps the project list envelope', async () => {
    const config = loadConfig();
    const context = await request.newContext({
      baseURL: config.baseUrl,
      extraHTTPHeaders: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
    });
    const client = new TodoistClient(context);

    const projects = await client.listProjects();

    // An array, not an envelope — proves `results` was unwrapped.
    expect(Array.isArray(projects)).toBe(true);
    // Every Todoist account has an Inbox.
    expect(projects.some((project) => project.inbox_project)).toBe(true);

    await context.dispose();
  });

  test('reads the account timezone', async () => {
    const config = loadConfig();
    const context = await request.newContext({
      baseURL: config.baseUrl,
      extraHTTPHeaders: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
    });
    const client = new TodoistClient(context);

    const user = await client.getUser();

    expect(user.tz_info.timezone).toBeTruthy();

    await context.dispose();
  });
});
```

- [ ] **Step 3: Run the smoke test to verify it fails**

Run: `npx playwright test tests/unit/client-smoke.spec.ts --reporter=list`
Expected: FAIL — `Cannot find module '../../src/api/todoist-client'`.

- [ ] **Step 4: Implement `src/api/todoist-client.ts`**

```typescript
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API_PREFIX } from '../config';
import type {
  CreateTaskInput,
  ListEnvelope,
  TodoistProject,
  TodoistTask,
  TodoistUser,
  UpdateTaskInput,
} from './types';

/**
 * A typed wrapper over Playwright's request context.
 *
 * Owns every Todoist path so no spec file constructs a raw request. Methods
 * throw a descriptive error on an unexpected status; the `*Raw` methods return
 * the untouched response for tests that assert on failure codes.
 */
export class TodoistClient {
  constructor(private readonly request: APIRequestContext) {}

  // --- Tasks -------------------------------------------------------------

  async createTask(input: CreateTaskInput): Promise<TodoistTask> {
    const response = await this.request.post(`${API_PREFIX}/tasks`, { data: input });
    return parse<TodoistTask>(response, `create task "${input.content}"`);
  }

  async getTask(id: string): Promise<TodoistTask> {
    const response = await this.request.get(`${API_PREFIX}/tasks/${id}`);
    return parse<TodoistTask>(response, `get task ${id}`);
  }

  /** Partial update. Todoist uses POST here, not PATCH or PUT. */
  async updateTask(id: string, input: UpdateTaskInput): Promise<TodoistTask> {
    const response = await this.request.post(`${API_PREFIX}/tasks/${id}`, { data: input });
    return parse<TodoistTask>(response, `update task ${id}`);
  }

  /** Completes a task. Responds 204 with no body. */
  async closeTask(id: string): Promise<void> {
    const response = await this.request.post(`${API_PREFIX}/tasks/${id}/close`);
    assertOk(response, `close task ${id}`);
  }

  /** Un-completes a task. Responds 204 with no body. */
  async reopenTask(id: string): Promise<void> {
    const response = await this.request.post(`${API_PREFIX}/tasks/${id}/reopen`);
    assertOk(response, `reopen task ${id}`);
  }

  /** Soft delete: the task keeps resolving by id with `is_deleted: true`. */
  async deleteTask(id: string): Promise<void> {
    const response = await this.request.delete(`${API_PREFIX}/tasks/${id}`);
    assertOk(response, `delete task ${id}`);
  }

  async listTasks(params: { project_id?: string } = {}): Promise<TodoistTask[]> {
    const response = await this.request.get(`${API_PREFIX}/tasks`, { params });
    const body = await parse<ListEnvelope<TodoistTask>>(response, 'list tasks');
    return body.results;
  }

  /**
   * Runs a Todoist filter query — the API equivalent of the calendar views.
   * Example: `due: today`, `due: tomorrow`.
   */
  async filterTasks(query: string): Promise<TodoistTask[]> {
    const response = await this.request.get(`${API_PREFIX}/tasks/filter`, {
      params: { query },
    });
    const body = await parse<ListEnvelope<TodoistTask>>(response, `filter tasks "${query}"`);
    return body.results;
  }

  /** True when `taskId` appears in the filter's results. */
  async filterContainsTask(query: string, taskId: string): Promise<boolean> {
    const tasks = await this.filterTasks(query);
    return tasks.some((task) => task.id === taskId);
  }

  // --- Projects ----------------------------------------------------------

  async listProjects(): Promise<TodoistProject[]> {
    const response = await this.request.get(`${API_PREFIX}/projects`);
    const body = await parse<ListEnvelope<TodoistProject>>(response, 'list projects');
    return body.results;
  }

  async createProject(name: string): Promise<TodoistProject> {
    const response = await this.request.post(`${API_PREFIX}/projects`, { data: { name } });
    return parse<TodoistProject>(response, `create project "${name}"`);
  }

  async deleteProject(id: string): Promise<void> {
    const response = await this.request.delete(`${API_PREFIX}/projects/${id}`);
    assertOk(response, `delete project ${id}`);
  }

  // --- Account -----------------------------------------------------------

  async getUser(): Promise<TodoistUser> {
    const response = await this.request.get(`${API_PREFIX}/user`);
    return parse<TodoistUser>(response, 'get user');
  }

  // --- Raw access for negative tests -------------------------------------

  /** Returns the untouched response so a test can assert a failure status. */
  async createTaskRaw(input: unknown): Promise<APIResponse> {
    return this.request.post(`${API_PREFIX}/tasks`, { data: input });
  }

  async getTaskRaw(id: string): Promise<APIResponse> {
    return this.request.get(`${API_PREFIX}/tasks/${id}`);
  }
}

function assertOk(response: APIResponse, action: string): void {
  if (!response.ok()) {
    throw new Error(
      `Todoist API could not ${action}: ${response.status()} ${response.statusText()}`,
    );
  }
}

async function parse<T>(response: APIResponse, action: string): Promise<T> {
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `Todoist API could not ${action}: ${response.status()} ${response.statusText()} — ${body}`,
    );
  }
  return (await response.json()) as T;
}
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `npx playwright test tests/unit/client-smoke.spec.ts --reporter=list`
Expected: PASS — 2 passed. A 401 here means the token in `.env` is wrong; a 410 means a `/rest/v2` path leaked into the client.

- [ ] **Step 6: Verify types compile**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Checkpoint**

Suggested commit message:

```
feat: add typed Todoist API v1 client with connectivity tests
```

---

### Task 3: Timezone-correct date helper

**Files:**
- Create: `src/utils/dates.ts`
- Test: `tests/unit/dates.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `dateInTimeZone(offsetDays: number, timeZone: string, now?: Date): string` returning `YYYY-MM-DD`, exported from `src/utils/dates.ts`. Task 6 depends on it.

Why this exists: the account is `Europe/Prague` and CI runners are UTC. Between 22:00 and 24:00 UTC the two zones sit on different calendar days, so `new Date()` arithmetic on a runner would compute a date Todoist disagrees with, and the scheduling tests would fail for two hours a day and pass the rest of the time.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dates.spec.ts`. Every case pins `now`, so these tests are deterministic wherever they run.

```typescript
import { test, expect } from '@playwright/test';
import { dateInTimeZone } from '../../src/utils/dates';

test.describe('dateInTimeZone', () => {
  test('returns today in the given timezone', () => {
    const now = new Date('2026-08-28T09:00:00Z');

    expect(dateInTimeZone(0, 'Europe/Prague', now)).toBe('2026-08-28');
  });

  test('returns tomorrow in the given timezone', () => {
    const now = new Date('2026-08-28T09:00:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2026-08-29');
  });

  test('uses the target timezone calendar day, not the UTC one', () => {
    // 23:30 UTC is already 01:30 on 29 August in Prague (+02:00).
    const now = new Date('2026-08-28T23:30:00Z');

    expect(dateInTimeZone(0, 'Europe/Prague', now)).toBe('2026-08-29');
    expect(dateInTimeZone(0, 'UTC', now)).toBe('2026-08-28');
  });

  test('shifts from the target timezone day, not the UTC day', () => {
    // The regression this helper exists to prevent: adding a day in UTC first
    // and formatting afterwards would yield 2026-08-30 here.
    const now = new Date('2026-08-28T23:30:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2026-08-30');
    expect(dateInTimeZone(1, 'UTC', now)).toBe('2026-08-29');
  });

  test('rolls over the end of a month', () => {
    const now = new Date('2026-08-31T09:00:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2026-09-01');
  });

  test('rolls over the end of a year', () => {
    const now = new Date('2026-12-31T09:00:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2027-01-01');
  });

  test('handles negative offsets', () => {
    const now = new Date('2026-09-01T09:00:00Z');

    expect(dateInTimeZone(-1, 'Europe/Prague', now)).toBe('2026-08-31');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/unit/dates.spec.ts --reporter=list`
Expected: FAIL — `Cannot find module '../../src/utils/dates'`.

- [ ] **Step 3: Implement `src/utils/dates.ts`**

```typescript
/**
 * Returns the calendar date `offsetDays` away from now, as seen in `timeZone`,
 * formatted `YYYY-MM-DD` to match the Todoist `due.date` field.
 *
 * The order of operations matters. The current instant is first reduced to a
 * calendar date *in the target timezone*, and only then shifted by whole days.
 * Shifting first and formatting afterwards would land on the wrong day
 * whenever UTC and the target timezone straddle midnight.
 */
export function dateInTimeZone(
  offsetDays: number,
  timeZone: string,
  now: Date = new Date(),
): string {
  // 'en-CA' formats as YYYY-MM-DD, the same shape the API uses.
  const todayInZone = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const [year, month, day] = todayInZone.split('-').map(Number);

  // Pure calendar arithmetic: Date.UTC normalises month and year rollover, and
  // UTC has no daylight-saving shifts to distort a whole-day offset.
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));

  return shifted.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/unit/dates.spec.ts --reporter=list`
Expected: PASS — 7 passed.

- [ ] **Step 5: Verify types compile**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Checkpoint**

Suggested commit message:

```
feat: add timezone-correct date helper for scheduling assertions
```

---

### Task 4: Test fixtures and global teardown

**Files:**
- Create: `src/fixtures/test-fixtures.ts`
- Replace: `src/global-teardown.ts` (the stub from Task 1)
- Test: `tests/unit/fixtures.spec.ts`

**Interfaces:**
- Consumes: `TodoistClient` (Task 2), `loadConfig` (Task 1), types (Task 2).
- Produces: from `src/fixtures/test-fixtures.ts` — `test` (extended Playwright test), `expect` (re-exported), `TEST_PROJECT_PREFIX: string`, and `runId: string`. Fixtures available to specs: `client: TodoistClient`, `testProject: TodoistProject`, `accountTimeZone: string` (all worker-scoped), plus `trackTask: (id: string) => void` and `uniqueContent: (label: string) => string` (test-scoped). Tasks 5–7 consume these.

- [ ] **Step 1: Write the failing fixture test**

Create `tests/unit/fixtures.spec.ts`:

```typescript
import { test, expect, TEST_PROJECT_PREFIX, runId } from '../../src/fixtures/test-fixtures';

test.describe('test fixtures', () => {
  // Serial mode: the last two tests hand a task id between them, which needs
  // them to run in order in the same worker. `fullyParallel` would otherwise
  // let Playwright spread tests in this file across workers.
  test.describe.configure({ mode: 'serial' });

  test('provides a dedicated project named for this run', async ({ testProject }) => {
    expect(testProject.id).toBeTruthy();
    expect(testProject.name).toContain(TEST_PROJECT_PREFIX);
    expect(testProject.name).toContain(runId);
    expect(testProject.inbox_project).toBeFalsy();
  });

  test('reads the account timezone', async ({ accountTimeZone }) => {
    expect(accountTimeZone).toBeTruthy();
  });

  test('generates unique content on every call', async ({ uniqueContent }) => {
    const first = uniqueContent('sample');
    const second = uniqueContent('sample');

    expect(first).not.toBe(second);
    expect(first).toContain(runId);
  });

  test('deletes tracked tasks after the test finishes', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const task = await client.createTask({
      content: uniqueContent('tracked'),
      project_id: testProject.id,
    });
    trackTask(task.id);

    // Cleanup runs in teardown, so this test only proves the task exists now.
    // The following test proves the teardown actually removed it.
    const tasks = await client.listTasks({ project_id: testProject.id });
    expect(tasks.map((t) => t.id)).toContain(task.id);

    process.env.FIXTURE_TRACKED_TASK_ID = task.id;
  });

  test('the previously tracked task is gone', async ({ client }) => {
    const trackedId = process.env.FIXTURE_TRACKED_TASK_ID;
    test.skip(!trackedId, 'runs only after the tracking test in the same worker');

    const deleted = await client.getTask(trackedId!);
    expect(deleted.is_deleted).toBe(true);
  });
});
```

Note the last two tests hand a task id to each other through the environment,
which needs them in the same worker in order. The config sets
`fullyParallel: true`, so that is **not** the default — the
`test.describe.configure({ mode: 'serial' })` line above is what makes it hold.
Without it these tests pass or fail depending on worker scheduling.

- [ ] **Step 2: Run the fixture test to verify it fails**

Run: `npx playwright test tests/unit/fixtures.spec.ts --reporter=list`
Expected: FAIL — `Cannot find module '../../src/fixtures/test-fixtures'`.

- [ ] **Step 3: Implement `src/fixtures/test-fixtures.ts`**

```typescript
import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { TodoistClient } from '../api/todoist-client';
import { loadConfig } from '../config';
import type { TodoistProject } from '../api/types';

/** Prefix that marks a project as belonging to this suite. */
export const TEST_PROJECT_PREFIX = 'pw-todoist-e2e';

/**
 * Identifier shared by every worker in one run. `playwright.config.ts` stamps
 * it into the environment of the main process before workers are forked, so
 * workers inherit the same value.
 */
export const runId = process.env.TODOIST_TEST_RUN_ID ?? 'local';

let contentCounter = 0;

interface WorkerFixtures {
  client: TodoistClient;
  testProject: TodoistProject;
  accountTimeZone: string;
}

interface TestFixtures {
  trackTask: (id: string) => void;
  uniqueContent: (label: string) => string;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // --- Worker-scoped -----------------------------------------------------

  client: [
    async ({}, use) => {
      const config = loadConfig();
      const context: APIRequestContext = await playwrightRequest.newContext({
        baseURL: config.baseUrl,
        extraHTTPHeaders: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      await use(new TodoistClient(context));

      await context.dispose();
    },
    { scope: 'worker' },
  ],

  accountTimeZone: [
    async ({ client }, use) => {
      const user = await client.getUser();
      await use(user.tz_info?.timezone ?? 'UTC');
    },
    { scope: 'worker' },
  ],

  // One project per worker rather than per test: the free Todoist plan caps
  // active projects, and a project-per-test suite would hit that ceiling.
  // Deleting the project removes any task still inside it.
  testProject: [
    async ({ client }, use, workerInfo) => {
      const project = await client.createProject(
        `${TEST_PROJECT_PREFIX}-${runId}-w${workerInfo.workerIndex}`,
      );

      await use(project);

      try {
        await client.deleteProject(project.id);
      } catch (error) {
        console.warn(`Could not delete test project ${project.id}: ${String(error)}`);
      }
    },
    { scope: 'worker' },
  ],

  // --- Test-scoped -------------------------------------------------------

  // Cleanup lives here rather than at the end of a test body, because a failed
  // assertion aborts the body but teardown still runs.
  trackTask: async ({ client }, use) => {
    const trackedIds: string[] = [];

    await use((id: string) => {
      trackedIds.push(id);
    });

    for (const id of trackedIds) {
      try {
        await client.deleteTask(id);
      } catch {
        // Already deleted by the test itself — nothing to clean up.
      }
    }
  },

  // Includes the worker index: `contentCounter` is per-process, so two workers
  // would otherwise mint identical strings.
  uniqueContent: async ({}, use, testInfo) => {
    await use(
      (label: string) =>
        `[${runId}] ${label} w${testInfo.workerIndex}#${++contentCounter}`,
    );
  },
});

export { expect };
```

- [ ] **Step 4: Replace `src/global-teardown.ts` with the real sweep**

A worker killed mid-run leaves its project behind, and the free plan caps active projects. This sweep removes any project this suite created, including strays from earlier runs.

```typescript
import { request } from '@playwright/test';
import { TodoistClient } from './api/todoist-client';
import { loadConfig } from './config';
import { TEST_PROJECT_PREFIX } from './fixtures/test-fixtures';

/**
 * Deletes leftover projects created by this suite.
 *
 * Worker teardown already removes each worker's own project; this catches the
 * case where a worker was killed before it could. Only projects carrying the
 * suite's prefix are touched, so real user data is never at risk.
 */
export default async function globalTeardown(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    return; // No token configured — nothing was created, nothing to sweep.
  }

  const context = await request.newContext({
    baseURL: config.baseUrl,
    extraHTTPHeaders: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    },
  });

  try {
    const client = new TodoistClient(context);
    const leftovers = (await client.listProjects()).filter((project) =>
      project.name.startsWith(TEST_PROJECT_PREFIX),
    );

    for (const project of leftovers) {
      try {
        await client.deleteProject(project.id);
        console.log(`Swept leftover test project: ${project.name}`);
      } catch (error) {
        console.warn(`Could not sweep project ${project.name}: ${String(error)}`);
      }
    }
  } finally {
    await context.dispose();
  }
}
```

- [ ] **Step 5: Run the fixture test to verify it passes**

Run: `npx playwright test tests/unit/fixtures.spec.ts --reporter=list`
Expected: PASS — 5 passed.

- [ ] **Step 6: Verify the account was left clean**

Run:

```bash
npx playwright test tests/unit/fixtures.spec.ts --reporter=line \
  && node -e "
const t=require('fs').readFileSync('.env','utf8').match(/TODOIST_API_TOKEN=(.+)/)[1].trim();
fetch('https://api.todoist.com/api/v1/projects',{headers:{Authorization:'Bearer '+t}})
  .then(r=>r.json())
  .then(d=>{
    const leftovers=d.results.filter(p=>p.name.startsWith('pw-todoist-e2e'));
    console.log('projects:',d.results.length,'| leftovers:',leftovers.length);
    process.exit(leftovers.length===0?0:1);
  });
"
```

Expected: `projects: 1 | leftovers: 0` and exit 0. A non-zero leftover count means teardown is not running.

- [ ] **Step 7: Checkpoint**

Suggested commit message:

```
feat: add fixtures with worker-scoped project and failure-safe cleanup
```

---

### Task 5: Task lifecycle scenarios

**Files:**
- Create: `tests/task-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, fixtures `client`, `testProject`, `trackTask`, `uniqueContent` (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the lifecycle spec**

```typescript
import { test, expect } from '../src/fixtures/test-fixtures';

test.describe('Task lifecycle', () => {
  test('creates a task with content and description', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const content = uniqueContent('create');

    const task = await client.createTask({
      content,
      description: 'Created by the automated suite',
      project_id: testProject.id,
    });
    trackTask(task.id);

    expect(task.id).toBeTruthy();
    expect(task.content).toBe(content);
    expect(task.description).toBe('Created by the automated suite');
    expect(task.project_id).toBe(testProject.id);
    expect(task.checked).toBe(false);
    expect(task.is_deleted).toBe(false);
  });

  test('reads a created task back by id', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const content = uniqueContent('read');
    const created = await client.createTask({ content, project_id: testProject.id });
    trackTask(created.id);

    const fetched = await client.getTask(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.content).toBe(content);
  });

  test('lists a created task inside its project', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const created = await client.createTask({
      content: uniqueContent('list'),
      project_id: testProject.id,
    });
    trackTask(created.id);

    const tasks = await client.listTasks({ project_id: testProject.id });

    // Assert on our own id, never on a count: the list is shared with any
    // test running in parallel.
    expect(tasks.map((task) => task.id)).toContain(created.id);
  });

  test('updates the content of a task', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const created = await client.createTask({
      content: uniqueContent('before-update'),
      project_id: testProject.id,
    });
    trackTask(created.id);
    const newContent = uniqueContent('after-update');

    const updated = await client.updateTask(created.id, { content: newContent });

    expect(updated.content).toBe(newContent);
    // Re-read, because a correct response body does not prove it persisted.
    const refetched = await client.getTask(created.id);
    expect(refetched.content).toBe(newContent);
  });

  test('completes a task', async ({ client, testProject, trackTask, uniqueContent }) => {
    const created = await client.createTask({
      content: uniqueContent('complete'),
      project_id: testProject.id,
    });
    trackTask(created.id);

    await client.closeTask(created.id);

    const completed = await client.getTask(created.id);
    expect(completed.checked).toBe(true);
    // A completed task drops out of the active list.
    const active = await client.listTasks({ project_id: testProject.id });
    expect(active.map((task) => task.id)).not.toContain(created.id);
  });

  test('reopens a completed task', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const created = await client.createTask({
      content: uniqueContent('reopen'),
      project_id: testProject.id,
    });
    trackTask(created.id);
    await client.closeTask(created.id);

    await client.reopenTask(created.id);

    const reopened = await client.getTask(created.id);
    expect(reopened.checked).toBe(false);
    const active = await client.listTasks({ project_id: testProject.id });
    expect(active.map((task) => task.id)).toContain(created.id);
  });

  test('deletes a task', async ({ client, testProject, uniqueContent }) => {
    const created = await client.createTask({
      content: uniqueContent('delete'),
      project_id: testProject.id,
    });

    await client.deleteTask(created.id);

    // Todoist soft-deletes: the id still resolves with 200, so the assertion
    // is absence from the list plus the is_deleted flag. Asserting a 404 here
    // would fail against correct behaviour.
    const remaining = await client.listTasks({ project_id: testProject.id });
    expect(remaining.map((task) => task.id)).not.toContain(created.id);

    const deleted = await client.getTask(created.id);
    expect(deleted.is_deleted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the lifecycle spec**

Run: `npx playwright test tests/task-lifecycle.spec.ts --reporter=list`
Expected: PASS — 7 passed.

- [ ] **Step 3: Verify no leftovers**

Run the leftover check from Task 4 Step 6.
Expected: `projects: 1 | leftovers: 0`.

- [ ] **Step 4: Checkpoint**

Suggested commit message:

```
test: cover task lifecycle — create, read, update, complete, reopen, delete
```

---

### Task 6: Scheduling and calendar scenarios

**Files:**
- Create: `tests/task-scheduling.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, fixtures `client`, `testProject`, `trackTask`, `uniqueContent`, `accountTimeZone` (Task 4); `dateInTimeZone` (Task 3).
- Produces: nothing consumed by later tasks.

This file covers the two scenarios called out in the request: confirming a task lands on a calendar date, and moving it to another date.

- [ ] **Step 1: Write the scheduling spec**

```typescript
import { test, expect } from '../src/fixtures/test-fixtures';
import { dateInTimeZone } from '../src/utils/dates';

test.describe('Task scheduling and calendar', () => {
  test('a task due today appears in the today filter', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
    accountTimeZone,
  }) => {
    // `due_string` is resolved by Todoist in the account timezone, and the
    // filter below is resolved the same way, so the two agree by construction
    // regardless of the runner's timezone.
    const task = await client.createTask({
      content: uniqueContent('due-today'),
      due_string: 'today',
      project_id: testProject.id,
    });
    trackTask(task.id);

    expect(task.due).not.toBeNull();
    expect(task.due?.date).toBe(dateInTimeZone(0, accountTimeZone));

    // The calendar check: the task is present in today's view.
    expect(await client.filterContainsTask('due: today', task.id)).toBe(true);
  });

  test('a task due tomorrow appears only in the tomorrow filter', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
    accountTimeZone,
  }) => {
    const task = await client.createTask({
      content: uniqueContent('due-tomorrow'),
      due_string: 'tomorrow',
      project_id: testProject.id,
    });
    trackTask(task.id);

    expect(task.due?.date).toBe(dateInTimeZone(1, accountTimeZone));
    expect(await client.filterContainsTask('due: tomorrow', task.id)).toBe(true);
    expect(await client.filterContainsTask('due: today', task.id)).toBe(false);
  });

  test('moves a task from today to tomorrow', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
    accountTimeZone,
  }) => {
    const task = await client.createTask({
      content: uniqueContent('move-date'),
      due_string: 'today',
      project_id: testProject.id,
    });
    trackTask(task.id);
    expect(await client.filterContainsTask('due: today', task.id)).toBe(true);

    const moved = await client.updateTask(task.id, { due_string: 'tomorrow' });

    expect(moved.due?.date).toBe(dateInTimeZone(1, accountTimeZone));
    // The task left one calendar day and arrived on the other.
    expect(await client.filterContainsTask('due: today', task.id)).toBe(false);
    expect(await client.filterContainsTask('due: tomorrow', task.id)).toBe(true);
  });

  test('removes a due date from a task', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const task = await client.createTask({
      content: uniqueContent('clear-date'),
      due_string: 'today',
      project_id: testProject.id,
    });
    trackTask(task.id);
    expect(task.due).not.toBeNull();

    const cleared = await client.updateTask(task.id, { due_string: 'no date' });

    expect(cleared.due).toBeNull();
    expect(await client.filterContainsTask('due: today', task.id)).toBe(false);
  });

  test('stores the priority a task was created with', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    // API priority is inverted relative to the UI: 4 is urgent, 1 is normal.
    const task = await client.createTask({
      content: uniqueContent('priority'),
      priority: 4,
      project_id: testProject.id,
    });
    trackTask(task.id);

    expect(task.priority).toBe(4);
    const refetched = await client.getTask(task.id);
    expect(refetched.priority).toBe(4);
  });

  test('creates a recurring task', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const task = await client.createTask({
      content: uniqueContent('recurring'),
      due_string: 'every day',
      project_id: testProject.id,
    });
    trackTask(task.id);

    expect(task.due?.is_recurring).toBe(true);
  });
});
```

- [ ] **Step 2: Run the scheduling spec**

Run: `npx playwright test tests/task-scheduling.spec.ts --reporter=list`
Expected: PASS — 6 passed.

If `removes a due date from a task` fails because the API keeps the date, check the response body in the failure output and adjust the payload to the documented clearing form — but do not weaken the assertion to make it pass.

- [ ] **Step 3: Verify no leftovers**

Run the leftover check from Task 4 Step 6.
Expected: `projects: 1 | leftovers: 0`.

- [ ] **Step 4: Checkpoint**

Suggested commit message:

```
test: cover scheduling, calendar filters, and moving a task between dates
```

---

### Task 7: Validation and error-handling scenarios

**Files:**
- Create: `tests/task-validation.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, fixtures `client`, `testProject`, `trackTask`, `uniqueContent` (Task 4); `loadConfig`, `API_PREFIX` (Task 1); `TodoistErrorBody` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the validation spec**

```typescript
import { request } from '@playwright/test';
import { test, expect } from '../src/fixtures/test-fixtures';
import { loadConfig, API_PREFIX } from '../src/config';
import type { TodoistErrorBody } from '../src/api/types';

test.describe('Validation and error handling', () => {
  test('rejects a request carrying an invalid token', async () => {
    const config = loadConfig();
    const context = await request.newContext({
      baseURL: config.baseUrl,
      extraHTTPHeaders: {
        Authorization: 'Bearer invalid-token-for-testing',
        'Content-Type': 'application/json',
      },
    });

    const response = await context.get(`${API_PREFIX}/tasks`);

    expect(response.status()).toBe(401);

    await context.dispose();
  });

  test('rejects a request carrying no token at all', async () => {
    const config = loadConfig();
    const context = await request.newContext({
      baseURL: config.baseUrl,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });

    const response = await context.get(`${API_PREFIX}/tasks`);

    expect(response.status()).toBe(401);

    await context.dispose();
  });

  test('rejects a task with empty content', async ({ client }) => {
    const response = await client.createTaskRaw({ content: '' });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as TodoistErrorBody;
    expect(body.error_tag).toBe('INVALID_ARGUMENT_VALUE');
  });

  test('rejects a task with no content field', async ({ client }) => {
    const response = await client.createTaskRaw({ description: 'no content field' });

    expect(response.status()).toBe(400);
  });

  test('rejects a malformed task id', async ({ client }) => {
    // Todoist answers 400 for an unparseable id, not 404.
    const response = await client.getTaskRaw('000000000000000000');

    expect(response.status()).toBe(400);
  });

  test('rejects an out-of-range priority', async ({ client, testProject, uniqueContent }) => {
    const response = await client.createTaskRaw({
      content: uniqueContent('bad-priority'),
      priority: 99,
      project_id: testProject.id,
    });

    expect(response.status()).toBe(400);
  });
});
```

- [ ] **Step 2: Run the validation spec**

Run: `npx playwright test tests/task-validation.spec.ts --reporter=list`
Expected: PASS — 6 passed.

If `rejects an out-of-range priority` returns 200, the API clamps rather than rejects. Read the returned task's `priority` in the failure output, then change that test to assert the documented clamping behaviour instead — record whichever behaviour is real, and note the change in the checkpoint.

- [ ] **Step 3: Run the whole suite together for the first time**

Run: `npm test`
Expected: all specs pass — 39 tests across seven spec files (config 6, client
smoke 2, dates 7, fixtures 5, lifecycle 7, scheduling 6, validation 6). This is
the first run with parallel workers, so it is also the real check that the
isolation rules hold.

- [ ] **Step 4: Verify no leftovers after a full parallel run**

Run the leftover check from Task 4 Step 6.
Expected: `projects: 1 | leftovers: 0`.

- [ ] **Step 5: Checkpoint**

Suggested commit message:

```
test: cover authentication and input validation failures
```

---

### Task 8: Markdown summary reporter

**Files:**
- Replace: `reporting/summary-reporter.ts` (the stub from Task 1)

**Interfaces:**
- Consumes: Playwright's `Reporter` interface.
- Produces: the default-exported reporter class already wired into `playwright.config.ts` in Task 1. Writes `test-results/summary.md` always, and appends to `$GITHUB_STEP_SUMMARY` when that variable is set.

- [ ] **Step 1: Implement the reporter**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

interface Row {
  suite: string;
  title: string;
  status: TestResult['status'];
  durationMs: number;
}

const STATUS_ICON: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  timedOut: '⏱️',
  skipped: '⏭️',
  interrupted: '⚠️',
};

/**
 * Writes a plain markdown result table.
 *
 * In GitHub Actions it appends to the job summary, so results are readable on
 * the run page with nothing to download. Locally it writes the same table to
 * test-results/summary.md and prints a one-line total. No network calls and no
 * third-party service.
 */
export default class SummaryReporter implements Reporter {
  private readonly rows: Row[] = [];
  private startedAt = 0;

  onBegin(): void {
    this.startedAt = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // titlePath() is [root, project, file, ...describes, title].
    const describes = test.titlePath().slice(3, -1);
    this.rows.push({
      suite: describes.join(' › ') || path.basename(test.location.file),
      title: test.title,
      status: result.status,
      durationMs: result.duration,
    });
  }

  onEnd(result: FullResult): void {
    const markdown = this.render(result);

    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(path.join('test-results', 'summary.md'), markdown, 'utf8');

    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      fs.appendFileSync(summaryFile, markdown, 'utf8');
    }

    const counts = this.counts();
    console.log(
      `\nSummary: ${counts.passed} passed, ${counts.failed} failed, ` +
        `${counts.skipped} skipped — written to test-results/summary.md`,
    );
  }

  private counts() {
    const passed = this.rows.filter((row) => row.status === 'passed').length;
    const failed = this.rows.filter(
      (row) => row.status === 'failed' || row.status === 'timedOut',
    ).length;
    const skipped = this.rows.filter((row) => row.status === 'skipped').length;
    return { passed, failed, skipped };
  }

  private render(result: FullResult): string {
    const { passed, failed, skipped } = this.counts();
    const totalSeconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const verdict = result.status === 'passed' ? '✅ Passed' : '❌ Failed';

    const lines: string[] = [
      '## Todoist API test results',
      '',
      `**${verdict}** — ${passed} passed · ${failed} failed · ${skipped} skipped · ${totalSeconds}s`,
      '',
    ];

    const failures = this.rows.filter(
      (row) => row.status === 'failed' || row.status === 'timedOut',
    );
    if (failures.length > 0) {
      lines.push('### Failures', '');
      for (const row of failures) {
        lines.push(`- ${STATUS_ICON[row.status] ?? ''} **${row.suite}** — ${row.title}`);
      }
      lines.push('');
    }

    lines.push('### All tests', '', '| | Scenario | Test | Time |', '|---|---|---|---|');
    for (const row of this.rows) {
      const icon = STATUS_ICON[row.status] ?? row.status;
      const seconds = (row.durationMs / 1000).toFixed(1);
      lines.push(`| ${icon} | ${escapePipes(row.suite)} | ${escapePipes(row.title)} | ${seconds}s |`);
    }
    lines.push('');

    return lines.join('\n');
  }
}

/** A pipe inside a cell would break the markdown table. */
function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}
```

- [ ] **Step 2: Run the suite and confirm the summary file is written**

Run: `npm test && cat test-results/summary.md`
Expected: the suite passes, and the file contains a `## Todoist API test results` heading, a verdict line with the counts, and a table row per test.

- [ ] **Step 3: Confirm the GitHub Actions path works**

Run:

```bash
GITHUB_STEP_SUMMARY=/tmp/step-summary.md npm test \
  && grep -c "Todoist API test results" /tmp/step-summary.md
```

Expected: `1` — the reporter appended to the file named by the variable. This is exactly what happens on a runner.

- [ ] **Step 4: Confirm the reporter still reports when tests fail**

Run:

```bash
cat > /tmp/failing.spec.ts <<'EOF'
import { test, expect } from '@playwright/test';
test('deliberate failure to check reporting', () => {
  expect(1).toBe(2);
});
EOF
cp /tmp/failing.spec.ts tests/failing.spec.ts
npx playwright test tests/failing.spec.ts --reporter=./reporting/summary-reporter.ts
grep -A3 "### Failures" test-results/summary.md
rm tests/failing.spec.ts
```

Expected: a `### Failures` section listing the deliberate failure. Confirm `tests/failing.spec.ts` is removed afterwards.

- [ ] **Step 5: Verify types compile**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Checkpoint**

Suggested commit message:

```
feat: add markdown summary reporter for GitHub job summaries
```

---

### Task 9: Daily GitHub Actions workflow and README

**Files:**
- Create: `.github/workflows/daily-api-tests.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: the `npm test` script (Task 1) and the reporter's `$GITHUB_STEP_SUMMARY` behaviour (Task 8).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create the workflow**

```yaml
name: Daily Todoist API Tests

on:
  schedule:
    # 06:00 UTC daily — 08:00 in Europe/Prague, the account's timezone.
    # Both zones sit on the same calendar day at this hour.
    - cron: '0 6 * * *'
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  api-tests:
    name: Run API tests
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Check out the repository
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Verify the API token secret is configured
        env:
          TODOIST_API_TOKEN: ${{ secrets.TODOIST_API_TOKEN }}
        run: |
          if [ -z "$TODOIST_API_TOKEN" ]; then
            echo "::error::TODOIST_API_TOKEN secret is not set. Add it under Settings → Secrets and variables → Actions."
            exit 1
          fi
          echo "Token secret is present."

      # No `playwright install`: this suite makes API calls only, so no
      # browser is ever launched and none needs downloading.
      - name: Run the API tests
        env:
          TODOIST_API_TOKEN: ${{ secrets.TODOIST_API_TOKEN }}
          TODOIST_TEST_RUN_ID: gh${{ github.run_id }}
        run: npm test

      - name: Upload the HTML report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-${{ github.run_id }}
          path: playwright-report/
          retention-days: 14
```

The summary reporter writes to `$GITHUB_STEP_SUMMARY` from inside the test run, so no separate publishing step is needed. The upload step carries `if: always()` so a failing run still produces its report.

- [ ] **Step 2: Validate the workflow YAML parses**

Run:

```bash
node -e "
const fs=require('fs');
const text=fs.readFileSync('.github/workflows/daily-api-tests.yml','utf8');
if(!/on:/.test(text)||!/cron: '0 6 \* \* \*'/.test(text)) throw new Error('workflow triggers missing');
if(/playwright install/.test(text)) throw new Error('browser install must not be present');
if(/[0-9a-f]{40}/.test(text)) throw new Error('a token-shaped literal is present in the workflow');
console.log('workflow looks correct');
"
```

Expected: `workflow looks correct`.

- [ ] **Step 3: Confirm no secret leaked anywhere trackable**

Search for anything token-shaped — a 40-character hex string — rather than for
the token itself, so this check never becomes a place the secret is written
down:

```bash
grep -rnE "[0-9a-f]{40}" . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=.env --exclude=package-lock.json || echo "CLEAN"
```

Expected: `CLEAN`. Any hit outside `.env` must be removed before the repository
is pushed. `package-lock.json` is excluded because npm integrity hashes match
the same shape and are not secrets.

- [ ] **Step 4: Write the README**

```markdown
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
| `tests/task-validation.spec.ts` | Invalid token, missing token, empty content, malformed id, bad priority |
| `tests/unit/` | Config loading, client connectivity, timezone date maths, fixture cleanup |

Out of scope by design: the UI, navigation, settings, and account management.

## Setup

```bash
npm install
cp .env.example .env    # then paste your token into .env
npm test
```

Get a token from Todoist → Settings → Integrations → Developer → API token.
No browser download is needed — the suite never opens one.

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
```

- [ ] **Step 5: Final full-suite verification**

Run: `npm test && npm run typecheck`
Expected: every test passes and the type check exits 0.

- [ ] **Step 6: Confirm the account is clean**

Run the leftover check from Task 4 Step 6.
Expected: `projects: 1 | leftovers: 0`.

- [ ] **Step 7: Checkpoint**

Suggested commit message:

```
ci: add daily GitHub Actions workflow and project README
```

The repository is ready to push. After pushing, add the `TODOIST_API_TOKEN`
secret in the repository settings, then use **Run workflow** on the Actions
tab to confirm the first run before relying on the schedule.

---

## Post-implementation

- Rotate the Todoist API token, which was shared in plain text during the
  workshop: Todoist → Settings → Integrations → Developer → revoke and reissue.
  Update `.env` and the GitHub secret with the new value.
