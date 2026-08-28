import type { TodoistProject } from '../api/types';

/**
 * Age past which a leftover project from *another* run is considered
 * abandoned rather than still in flight.
 */
export const STALE_PROJECT_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Decides whether a project the global-teardown sweep found should be
 * deleted.
 *
 * Anchored to `` `${prefix}-` `` so a real user project that merely starts
 * with the bare prefix (e.g. "pw-todoist-e2e-ing notes") is never touched.
 *
 * Among suite-created projects: this run's own project is always swept,
 * mirroring the immediate cleanup the worker-scoped `testProject` fixture
 * already attempts on itself. A project from a *different* run is swept
 * only once it is older than `STALE_PROJECT_AGE_MS` — a live concurrent run
 * (e.g. a daily CI run) never has a project that old, so a run finishing
 * while another run is still in flight cannot delete that other run's
 * project out from under it.
 */
export function shouldSweepProject(
  project: Pick<TodoistProject, 'name' | 'created_at'>,
  prefix: string,
  runId: string,
  now: Date,
): boolean {
  if (!project.name.startsWith(`${prefix}-`)) {
    return false;
  }

  // Match the exact `-${runId}-` segment, not a bare substring: CI run ids
  // (`gh${github.run_id}`) are variable length, so a shorter id can be a
  // strict prefix of a longer one (e.g. "gh123" of "gh1234"), and a
  // substring match would then treat another run's project as this run's.
  if (project.name.includes(`-${runId}-`)) {
    return true;
  }

  const ageMs = now.getTime() - new Date(project.created_at).getTime();
  return ageMs > STALE_PROJECT_AGE_MS;
}
