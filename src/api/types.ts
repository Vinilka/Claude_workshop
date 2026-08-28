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
  /** ISO 8601 UTC timestamp, e.g. "2026-08-28T08:00:45.213951Z". */
  created_at: string;
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
