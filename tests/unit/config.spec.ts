import { test, expect } from '@playwright/test';
import { loadConfig, API_PREFIX, TEST_PROJECT_PREFIX } from '../../src/config';

test.describe('loadConfig', () => {
  test('returns the token and default base URL when the token is set', () => {
    const config = loadConfig({ TODOIST_API_TOKEN: 'abc123' });

    expect(config.apiToken).toBe('abc123');
    expect(config.baseUrl).toBe('https://api.todoist.com');
  });

  test('trims surrounding whitespace from the token', () => {
    const config = loadConfig({ TODOIST_API_TOKEN: '  abc123  ' });

    expect(config.apiToken).toBe('abc123');
  });

  test('throws a named, actionable error when the token is missing', () => {
    expect(() => loadConfig({})).toThrow(/TODOIST_API_TOKEN/);
  });

  test('throws when the token is present but empty', () => {
    expect(() => loadConfig({ TODOIST_API_TOKEN: '   ' })).toThrow(/TODOIST_API_TOKEN/);
  });

  test('allows the base URL to be overridden', () => {
    const config = loadConfig({
      TODOIST_API_TOKEN: 'abc123',
      TODOIST_BASE_URL: 'https://staging.todoist.com',
    });

    expect(config.baseUrl).toBe('https://staging.todoist.com');
  });

  test('exposes the versioned API prefix', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });

  test('exposes the test project prefix', () => {
    expect(TEST_PROJECT_PREFIX).toBe('pw-todoist-e2e');
  });
});
