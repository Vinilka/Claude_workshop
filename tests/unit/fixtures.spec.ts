import { test, expect, TEST_PROJECT_PREFIX, runId } from '../../src/fixtures/test-fixtures';

// @live: the fixtures under test create a real project and real tasks.
test.describe('test fixtures @live', () => {
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
