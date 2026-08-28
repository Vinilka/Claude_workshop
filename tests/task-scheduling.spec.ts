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
