import 'dotenv/config';

/** Version prefix for every Todoist API path. The `/rest/v2` API is retired. */
export const API_PREFIX = '/api/v1';

/** Prefix marking a project as created by this suite. */
export const TEST_PROJECT_PREFIX = 'pw-todoist-e2e';

/**
 * Identifier shared by every worker (and by global teardown) in one run.
 * `playwright.config.ts` stamps it into the environment of the main process
 * before workers are forked, so every worker inherits the same value, and
 * global teardown — which runs in that same main process — reads it back
 * the same way.
 */
export const runId = process.env.TODOIST_TEST_RUN_ID ?? 'local';

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
