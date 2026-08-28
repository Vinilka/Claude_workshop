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

/** Documented maximum page size for Todoist's paginated list/filter endpoints. */
const PAGE_LIMIT = 200;

/**
 * Hard ceiling on how many pages a single paginated call will follow. Guards
 * against a malformed or repeating `next_cursor` looping forever. If this is
 * hit, `fetchAllPages` throws rather than returning a partial result —
 * silently truncating would reintroduce the "task invisible past page 1" bug
 * this pagination support exists to fix, just at a different threshold.
 */
export const MAX_PAGES = 50;

/**
 * Follows `next_cursor` across a paginated Todoist endpoint, concatenating
 * `results` from every page in order.
 *
 * `fetchPage` is injected (rather than this looping directly over
 * `this.request`) so the paging logic — the part that decides whether to
 * keep going — can be unit-tested against a fake page source, with no live
 * account and no need to actually hold hundreds of tasks.
 */
export async function fetchAllPages<T>(
  fetchPage: (cursor: string | null) => Promise<ListEnvelope<T>>,
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchPage(cursor);
    results.push(...body.results);

    if (body.next_cursor === null) {
      return results;
    }
    cursor = body.next_cursor;
  }

  throw new Error(
    `Todoist pagination did not terminate within ${MAX_PAGES} pages ` +
      '(next_cursor kept returning non-null — possibly malformed or repeating).',
  );
}

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
    return fetchAllPages<TodoistTask>((cursor) =>
      this.fetchPage<TodoistTask>(`${API_PREFIX}/tasks`, params, cursor, 'list tasks'),
    );
  }

  /**
   * Runs a Todoist filter query — the API equivalent of the calendar views.
   * Example: `due: today`, `due: tomorrow`. Filter queries are account-wide,
   * so this pages through every match rather than only the first page.
   */
  async filterTasks(query: string): Promise<TodoistTask[]> {
    return fetchAllPages<TodoistTask>((cursor) =>
      this.fetchPage<TodoistTask>(
        `${API_PREFIX}/tasks/filter`,
        { query },
        cursor,
        `filter tasks "${query}"`,
      ),
    );
  }

  /** True when `taskId` appears in the filter's results. */
  async filterContainsTask(query: string, taskId: string): Promise<boolean> {
    const tasks = await this.filterTasks(query);
    return tasks.some((task) => task.id === taskId);
  }

  /**
   * Fetches one page of a paginated list/filter endpoint: `baseParams` plus
   * `limit` and, once paging has started, `cursor`. Used as the injected
   * `fetchPage` for `fetchAllPages`.
   */
  private async fetchPage<T>(
    path: string,
    baseParams: Record<string, string | undefined>,
    cursor: string | null,
    action: string,
  ): Promise<ListEnvelope<T>> {
    const params: Record<string, string | number> = { limit: PAGE_LIMIT };
    for (const [key, value] of Object.entries(baseParams)) {
      if (value !== undefined) {
        params[key] = value;
      }
    }
    if (cursor !== null) {
      params.cursor = cursor;
    }

    const response = await this.request.get(path, { params });
    return parse<ListEnvelope<T>>(response, action);
  }

  // --- Projects ----------------------------------------------------------

  async listProjects(): Promise<TodoistProject[]> {
    return fetchAllPages<TodoistProject>((cursor) =>
      this.fetchPage<TodoistProject>(`${API_PREFIX}/projects`, {}, cursor, 'list projects'),
    );
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
