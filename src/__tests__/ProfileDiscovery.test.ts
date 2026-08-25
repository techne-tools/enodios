import { describe, expect, it, vi, afterEach } from 'vitest';

import { listProfiles } from '../ProfileDiscovery.ts';

// Mock fs and os so the test never touches the real home directory.
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn()
  };
});

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test-user')
}));

import { existsSync, readdirSync } from 'fs';

const mockExists = existsSync as ReturnType<typeof vi.fn>;
const mockReaddir = readdirSync as ReturnType<typeof vi.fn>;

describe('listProfiles', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns only "default" when no profiles directory exists', () => {
    mockExists.mockReturnValue(false);

    expect(listProfiles('/home/test-user/.hermes')).toEqual(['default']);
    expect(mockExists).toHaveBeenCalledWith('/home/test-user/.hermes/profiles');
  });

  it('lists profile directories alongside "default" (default first)', () => {
    mockExists.mockReturnValue(true);
    mockReaddir.mockReturnValue([
      { isDirectory: () => true, name: 'enodios' },
      { isDirectory: () => true, name: 'research' },
      { isDirectory: () => false, name: 'notes.md' },
      { isDirectory: () => true, name: '.hidden' }
    ]);

    expect(listProfiles('/home/test-user/.hermes')).toEqual([
      'default',
      'enodios',
      'research'
    ]);
  });

  it('sorts profiles alphabetically after default', () => {
    mockExists.mockReturnValue(true);
    mockReaddir.mockReturnValue([
      { isDirectory: () => true, name: 'zeta' },
      { isDirectory: () => true, name: 'alpha' }
    ]);

    expect(listProfiles('/home/test-user/.hermes')).toEqual([
      'default',
      'alpha',
      'zeta'
    ]);
  });

  it('falls back to HERMES_HOME env var when no explicit home is given', () => {
    const previous = process.env['HERMES_HOME'];
    process.env['HERMES_HOME'] = '/custom/hermes-home';
    mockExists.mockReturnValue(false);

    try {
      expect(listProfiles()).toEqual(['default']);
      expect(mockExists).toHaveBeenCalledWith('/custom/hermes-home/profiles');
    } finally {
      if (previous === undefined) {
        delete process.env['HERMES_HOME'];
      } else {
        process.env['HERMES_HOME'] = previous;
      }
    }
  });
});
