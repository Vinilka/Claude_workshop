import { request } from '@playwright/test';
import { TodoistClient } from './api/todoist-client';
import { loadConfig, runId, TEST_PROJECT_PREFIX } from './config';
import { shouldSweepProject, STALE_PROJECT_AGE_MS } from './utils/sweep';

/**
 * Deletes leftover projects created by this suite.
 *
 * Worker teardown already removes each worker's own project; this catches
 * the case where a worker was killed before it could. Only projects
 * carrying the suite's prefix are ever considered, so real user data is
 * never at risk — and among those, a project from a run other than this one
 * is deleted only once it is old enough that it cannot still be in flight
 * (see `shouldSweepProject`), so a run finishing while another (e.g. a
 * concurrent CI run) is still in progress cannot delete that run's project
 * out from under it.
 */
export default async function globalTeardown(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    return; // No token configured — nothing was created, nothing to sweep.
  }

  const context = await request.newContext({
    baseURL: config.baseUrl,
    extraHTTPHeaders: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    },
  });

  try {
    const client = new TodoistClient(context);
    const now = new Date();
    // Anchored to `${prefix}-` (not the bare prefix) so a real user project
    // that merely starts with the prefix, e.g. "pw-todoist-e2e-ing notes",
    // never reaches the sweep loop at all — `shouldSweepProject` re-checks
    // the same anchor for its own correctness in isolation, but filtering
    // here keeps that case out of the swept/skipped log entirely instead of
    // logging it as "belongs to a different run", which would be misleading.
    const candidates = (await client.listProjects()).filter((project) =>
      project.name.startsWith(`${TEST_PROJECT_PREFIX}-`),
    );

    for (const project of candidates) {
      if (shouldSweepProject(project, TEST_PROJECT_PREFIX, runId, now)) {
        try {
          await client.deleteProject(project.id);
          console.log(`Swept leftover test project: ${project.name}`);
        } catch (error) {
          console.warn(`Could not sweep project ${project.name}: ${String(error)}`);
        }
      } else {
        const ageHours = Math.round(STALE_PROJECT_AGE_MS / 3_600_000);
        console.log(
          `Skipped project ${project.name}: belongs to a different run and ` +
            `is under ${ageHours}h old — it may still be in flight.`,
        );
      }
    }
  } finally {
    await context.dispose();
  }
}
