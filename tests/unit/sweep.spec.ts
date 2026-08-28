import { test, expect } from '@playwright/test';
import { shouldSweepProject, STALE_PROJECT_AGE_MS } from '../../src/utils/sweep';

const PREFIX = 'pw-todoist-e2e';
const NOW = new Date('2026-08-28T12:00:00.000Z');

function projectAt(name: string, createdAt: string) {
  return { name, created_at: createdAt };
}

test.describe('shouldSweepProject', () => {
  test("sweeps this run's own project unconditionally, even brand new", () => {
    const project = projectAt(
      `${PREFIX}-run123-w0`,
      new Date(NOW.getTime()).toISOString(), // created right now
    );

    expect(shouldSweepProject(project, PREFIX, 'run123', NOW)).toBe(true);
  });

  test("does NOT sweep another run's project that is only 10 minutes old", () => {
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    const project = projectAt(`${PREFIX}-otherRun-w0`, tenMinutesAgo);

    expect(shouldSweepProject(project, PREFIX, 'run123', NOW)).toBe(false);
  });

  test("sweeps another run's project once it is 3 hours old", () => {
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const project = projectAt(`${PREFIX}-otherRun-w0`, threeHoursAgo);

    expect(shouldSweepProject(project, PREFIX, 'run123', NOW)).toBe(true);
  });

  test('does NOT sweep a real user project that merely starts with the prefix', () => {
    // Old enough to clear the stale-age gate on its own, and unrelated to
    // "run123" — only the missing `${prefix}-` anchor can save it here. The
    // character right after the bare prefix is deliberately not a hyphen, so
    // this name starts with PREFIX but not with `${PREFIX}-`.
    const longAgo = new Date(NOW.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const project = projectAt('pw-todoist-e2experimental-notes', longAgo);

    expect(shouldSweepProject(project, PREFIX, 'run123', NOW)).toBe(false);
  });

  test("does NOT treat another run's project as this run's when that run's " +
    "id is a strict prefix of this run's id, even brand new", () => {
    // Current run is "gh1234"; the stray project belongs to "gh123", which
    // is a strict prefix of "gh1234". A bare `.includes(runId)` substring
    // check would wrongly match "gh1234" against "gh123" here. Freshly
    // created, so only the exact-segment match (not the stale-age fallback)
    // can be saving it.
    const project = projectAt(`${PREFIX}-gh123-w0`, NOW.toISOString());

    expect(shouldSweepProject(project, PREFIX, 'gh1234', NOW)).toBe(false);
  });

  test('is exactly at the boundary: not-yet-stale is not swept', () => {
    const exactlyAtThreshold = new Date(NOW.getTime() - STALE_PROJECT_AGE_MS).toISOString();
    const project = projectAt(`${PREFIX}-otherRun-w0`, exactlyAtThreshold);

    // Strictly greater-than: a project exactly at the threshold age is not
    // yet considered stale.
    expect(shouldSweepProject(project, PREFIX, 'run123', NOW)).toBe(false);
  });

  test('is exactly at the boundary plus one millisecond: stale and swept', () => {
    const justPastThreshold = new Date(
      NOW.getTime() - STALE_PROJECT_AGE_MS - 1,
    ).toISOString();
    const project = projectAt(`${PREFIX}-otherRun-w0`, justPastThreshold);

    expect(shouldSweepProject(project, PREFIX, 'run123', NOW)).toBe(true);
  });
});
