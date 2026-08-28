import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { TodoistClient } from '../api/todoist-client';
import { loadConfig, runId, TEST_PROJECT_PREFIX } from '../config';
import type { TodoistProject } from '../api/types';

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

export { expect, TEST_PROJECT_PREFIX, runId };
