import { request } from '@playwright/test';
import { test, expect } from '../src/fixtures/test-fixtures';
import { loadConfig, API_PREFIX } from '../src/config';
import type { TodoistErrorBody, TodoistTask } from '../src/api/types';

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

  // UNVERIFIED-against-live-API scenario: the brief expected a 400 rejection.
  // The real Todoist API instead accepts the request (200) and silently
  // clamps an out-of-range `priority` down to 1 (the default "normal"
  // priority), rather than to the nearest valid bound (4). Confirmed by
  // direct API probe: POST /tasks with priority: 99 returns
  // `"priority": 1` in the body. Asserting the actual behaviour here rather
  // than the brief's assumed 400.
  test('clamps an out-of-range priority instead of rejecting it', async ({
    client,
    testProject,
    trackTask,
    uniqueContent,
  }) => {
    const response = await client.createTaskRaw({
      content: uniqueContent('bad-priority'),
      priority: 99,
      project_id: testProject.id,
    });

    expect(response.status()).toBe(200);
    const body = (await response.json()) as TodoistTask;
    trackTask(body.id);
    expect(body.priority).toBe(1);
  });
});
