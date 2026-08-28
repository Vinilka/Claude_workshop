import * as fs from 'fs';
import * as path from 'path';
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

interface Row {
  suite: string;
  title: string;
  status: TestResult['status'];
  durationMs: number;
  /** Number of attempts (1 + retries) that produced this row's final result. */
  attempts: number;
}

const STATUS_ICON: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  timedOut: '⏱️',
  skipped: '⏭️',
  interrupted: '⚠️',
};

/** Appended to a test's title when it needed more than one attempt, so a
 * retry that flipped the result stays visible instead of just vanishing
 * behind the final attempt's status. */
const FLAKY_SUFFIX = ' 🔁 (flaky)';

/**
 * Writes a plain markdown result table.
 *
 * In GitHub Actions it appends to the job summary, so results are readable on
 * the run page with nothing to download. Locally it writes the same table to
 * test-results/summary.md and prints a one-line total. No network calls and no
 * third-party service.
 */
export default class SummaryReporter implements Reporter {
  // Keyed by TestCase.id. `onTestEnd` fires once per attempt (CI sets
  // `retries: 1`), so a test that fails then passes on retry would otherwise
  // produce two rows — a stray ❌ alongside its eventual ✅ — and skew the
  // header counts into a self-contradictory "passed" total with failures
  // still listed. Keying by id and overwriting on each call keeps only the
  // last attempt's result per test, while `attempts` (incremented on every
  // call for the same id) records that a retry happened at all.
  private readonly rows = new Map<string, Row>();
  private startedAt = 0;

  onBegin(): void {
    this.startedAt = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // titlePath() is [root, project, file, ...describes, title].
    const describes = test.titlePath().slice(3, -1);
    const previousAttempts = this.rows.get(test.id)?.attempts ?? 0;
    this.rows.set(test.id, {
      suite: describes.join(' › ') || path.basename(test.location.file),
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      attempts: previousAttempts + 1,
    });
  }

  onEnd(result: FullResult): void {
    const markdown = this.render(result);

    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(path.join('test-results', 'summary.md'), markdown, 'utf8');

    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      fs.appendFileSync(summaryFile, markdown, 'utf8');
    }

    const counts = this.counts();
    console.log(
      `\nSummary: ${counts.passed} passed, ${counts.failed} failed, ` +
        `${counts.skipped} skipped — written to test-results/summary.md`,
    );
  }

  private counts() {
    const rows = [...this.rows.values()];
    const passed = rows.filter((row) => row.status === 'passed').length;
    const failed = rows.filter(
      (row) => row.status === 'failed' || row.status === 'timedOut',
    ).length;
    const skipped = rows.filter((row) => row.status === 'skipped').length;
    return { passed, failed, skipped };
  }

  private render(result: FullResult): string {
    const rows = [...this.rows.values()];
    const { passed, failed, skipped } = this.counts();
    const totalSeconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const verdict = result.status === 'passed' ? '✅ Passed' : '❌ Failed';

    const lines: string[] = [
      '## Todoist API test results',
      '',
      `**${verdict}** — ${passed} passed · ${failed} failed · ${skipped} skipped · ${totalSeconds}s`,
      '',
    ];

    const failures = rows.filter(
      (row) => row.status === 'failed' || row.status === 'timedOut',
    );
    if (failures.length > 0) {
      lines.push('### Failures', '');
      for (const row of failures) {
        lines.push(`- ${STATUS_ICON[row.status] ?? ''} **${row.suite}** — ${titleCell(row)}`);
      }
      lines.push('');
    }

    lines.push('### All tests', '', '| | Scenario | Test | Time |', '|---|---|---|---|');
    for (const row of rows) {
      const icon = STATUS_ICON[row.status] ?? row.status;
      const seconds = (row.durationMs / 1000).toFixed(1);
      lines.push(
        `| ${icon} | ${escapePipes(row.suite)} | ${escapePipes(titleCell(row))} | ${seconds}s |`,
      );
    }
    lines.push('');

    return lines.join('\n');
  }
}

/** The row's title, with a flaky marker appended when it took more than one attempt. */
function titleCell(row: Row): string {
  return row.attempts > 1 ? `${row.title}${FLAKY_SUFFIX}` : row.title;
}

/** A pipe inside a cell would break the markdown table. */
function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}
