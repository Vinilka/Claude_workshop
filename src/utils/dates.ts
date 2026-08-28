/**
 * Returns the calendar date `offsetDays` away from now, as seen in `timeZone`,
 * formatted `YYYY-MM-DD` to match the Todoist `due.date` field.
 *
 * The order of operations matters. The current instant is first reduced to a
 * calendar date *in the target timezone*, and only then shifted by whole days.
 * Shifting first and formatting afterwards would land on the wrong day
 * whenever UTC and the target timezone straddle midnight.
 */
export function dateInTimeZone(
  offsetDays: number,
  timeZone: string,
  now: Date = new Date(),
): string {
  // 'en-CA' formats as YYYY-MM-DD, the same shape the API uses.
  const todayInZone = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const [year, month, day] = todayInZone.split('-').map(Number);

  // Pure calendar arithmetic: Date.UTC normalises month and year rollover, and
  // UTC has no daylight-saving shifts to distort a whole-day offset.
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));

  return shifted.toISOString().slice(0, 10);
}
