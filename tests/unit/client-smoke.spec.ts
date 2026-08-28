import { test, expect, request } from '@playwright/test';
import { TodoistClient } from '../../src/api/todoist-client';
import { loadConfig } from '../../src/config';

// @live: these two hit the real account, unlike the rest of tests/unit.
test.describe('TodoistClient connectivity @live', () => {
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
