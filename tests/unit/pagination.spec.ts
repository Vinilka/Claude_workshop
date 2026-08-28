import { test, expect } from '@playwright/test';
import { fetchAllPages, MAX_PAGES } from '../../src/api/todoist-client';
import type { ListEnvelope } from '../../src/api/types';

/**
 * `fetchAllPages` is the paging loop extracted from `listTasks`, `filterTasks`,
 * and `listProjects`. It takes an injected page-fetching function so the loop
 * itself — the part that decides whether to keep going — can be proven
 * correct without a live Todoist account or hundreds of real tasks.
 */
test.describe('fetchAllPages', () => {
  test('returns the results of a single page when next_cursor is null', async () => {
    const page: ListEnvelope<string> = { results: ['a', 'b'], next_cursor: null };

    const results = await fetchAllPages<string>(async () => page);

    expect(results).toEqual(['a', 'b']);
  });

  test('concatenates results across multiple pages, in order', async () => {
    const pages: Record<string, ListEnvelope<string>> = {
      // Fetched first, when the loop passes a null cursor.
      start: { results: ['a', 'b'], next_cursor: 'page-2' },
      'page-2': { results: ['c', 'd'], next_cursor: 'page-3' },
      'page-3': { results: ['e'], next_cursor: null },
    };

    const results = await fetchAllPages<string>(async (cursor) => pages[cursor ?? 'start']);

    expect(results).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('passes the previous page next_cursor into the following fetch', async () => {
    const seenCursors: (string | null)[] = [];
    const pages: Record<string, ListEnvelope<number>> = {
      start: { results: [1], next_cursor: 'cursor-a' },
      'cursor-a': { results: [2], next_cursor: null },
    };

    await fetchAllPages<number>(async (cursor) => {
      seenCursors.push(cursor);
      return pages[cursor ?? 'start'];
    });

    expect(seenCursors).toEqual([null, 'cursor-a']);
  });

  test('throws instead of truncating or looping forever when the page cap is hit', async () => {
    let calls = 0;
    // A cursor that never resolves to null — simulates a malformed or
    // repeating cursor from the API.
    const fetchPage = async (): Promise<ListEnvelope<number>> => {
      calls++;
      return { results: [calls], next_cursor: 'always-more' };
    };

    await expect(fetchAllPages<number>(fetchPage)).rejects.toThrow();
    // It must have actually stopped at the cap, not looped forever or
    // returned a silently truncated page.
    expect(calls).toBe(MAX_PAGES);
  });
});
