import { test, expect } from '@playwright/test';
import { dateInTimeZone } from '../../src/utils/dates';

test.describe('dateInTimeZone', () => {
  test('returns today in the given timezone', () => {
    const now = new Date('2026-08-28T09:00:00Z');

    expect(dateInTimeZone(0, 'Europe/Prague', now)).toBe('2026-08-28');
  });

  test('returns tomorrow in the given timezone', () => {
    const now = new Date('2026-08-28T09:00:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2026-08-29');
  });

  test('uses the target timezone calendar day, not the UTC one', () => {
    // 23:30 UTC is already 01:30 on 29 August in Prague (+02:00).
    const now = new Date('2026-08-28T23:30:00Z');

    expect(dateInTimeZone(0, 'Europe/Prague', now)).toBe('2026-08-29');
    expect(dateInTimeZone(0, 'UTC', now)).toBe('2026-08-28');
  });

  test('shifts from the target timezone day, not the UTC day', () => {
    // The regression this helper exists to prevent: adding a day in UTC first
    // and formatting afterwards would yield 2026-08-30 here.
    const now = new Date('2026-08-28T23:30:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2026-08-30');
    expect(dateInTimeZone(1, 'UTC', now)).toBe('2026-08-29');
  });

  test('rolls over the end of a month', () => {
    const now = new Date('2026-08-31T09:00:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2026-09-01');
  });

  test('rolls over the end of a year', () => {
    const now = new Date('2026-12-31T09:00:00Z');

    expect(dateInTimeZone(1, 'Europe/Prague', now)).toBe('2027-01-01');
  });

  test('handles negative offsets', () => {
    const now = new Date('2026-09-01T09:00:00Z');

    expect(dateInTimeZone(-1, 'Europe/Prague', now)).toBe('2026-08-31');
  });
});
