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
