import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  addCity,
  addWorkspace,
  emptySettings,
  getSettingsPath,
  loadSettings,
  normalizeSettings,
  removeCity,
  removeWorkspace,
  saveSettings
} from './settings-store.js';

/** @type {string[]} */
const tmps = [];

function mkdtemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-settings-'));
  tmps.push(dir);
  return dir;
}

beforeEach(() => {});

afterEach(() => {
  for (const d of tmps.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('getSettingsPath', () => {
  test('honours XDG_CONFIG_HOME when set', () => {
    const p = getSettingsPath({
      env: { XDG_CONFIG_HOME: '/xdg' },
      homedir: '/home/u'
    });
    expect(p).toBe(path.join('/xdg', 'beads-ui', 'settings.json'));
  });

  test('falls back to ~/.beads-ui/settings.json when ~/.config does not exist', () => {
    const home = mkdtemp();
    const p = getSettingsPath({ env: {}, homedir: home });
    expect(p).toBe(path.join(home, '.beads-ui', 'settings.json'));
  });

  test('uses ~/.config/beads-ui when present', () => {
    const home = mkdtemp();
    fs.mkdirSync(path.join(home, '.config'));
    const p = getSettingsPath({ env: {}, homedir: home });
    expect(p).toBe(path.join(home, '.config', 'beads-ui', 'settings.json'));
  });
});

describe('normalizeSettings', () => {
  test('returns empty doc on null/garbage', () => {
    expect(normalizeSettings(null)).toEqual({ workspaces: [], cities: [] });
    expect(normalizeSettings(42)).toEqual({ workspaces: [], cities: [] });
    expect(normalizeSettings({ workspaces: 'no' })).toEqual({
      workspaces: [],
      cities: []
    });
  });

  test('drops malformed entries', () => {
    const out = normalizeSettings({
      workspaces: [
        { path: '/a' },
        null,
        { label: 'no path' },
        { path: '/b', label: 'B' }
      ],
      cities: [{ config_path: '/x/city.toml' }, {}]
    });
    expect(out.workspaces.length).toBe(2);
    expect(out.workspaces[1].label).toBe('B');
    expect(out.cities.length).toBe(1);
  });
});

describe('load / save roundtrip', () => {
  test('returns empty doc when file is absent', () => {
    const home = mkdtemp();
    const s = loadSettings({ env: {}, homedir: home });
    expect(s).toEqual(emptySettings());
  });

  test('save creates parent dirs and reloads', () => {
    const home = mkdtemp();
    const p = path.join(home, '.config', 'beads-ui', 'settings.json');
    saveSettings(
      {
        workspaces: [{ path: '/x', label: 'X' }],
        cities: [{ config_path: '/y/city.toml' }]
      },
      { path: p }
    );
    expect(fs.existsSync(p)).toBe(true);
    const back = loadSettings({ path: p });
    expect(back.workspaces).toEqual([{ path: '/x', label: 'X' }]);
    expect(back.cities).toEqual([{ config_path: '/y/city.toml' }]);
  });
});

describe('add/remove helpers', () => {
  test('addWorkspace dedupes by abs path and updates label', () => {
    const home = mkdtemp();
    const p = path.join(home, 'settings.json');
    addWorkspace({ path: '/a', label: 'one' }, { path: p });
    addWorkspace({ path: '/a', label: 'two' }, { path: p });
    const s = loadSettings({ path: p });
    expect(s.workspaces.length).toBe(1);
    expect(s.workspaces[0].label).toBe('two');
  });

  test('removeWorkspace drops matching entry', () => {
    const home = mkdtemp();
    const p = path.join(home, 'settings.json');
    addWorkspace({ path: '/a' }, { path: p });
    addWorkspace({ path: '/b' }, { path: p });
    removeWorkspace('/a', { path: p });
    const s = loadSettings({ path: p });
    expect(s.workspaces.map((w) => w.path)).toEqual(['/b']);
  });

  test('addCity / removeCity', () => {
    const home = mkdtemp();
    const p = path.join(home, 'settings.json');
    addCity({ config_path: '/c/city.toml' }, { path: p });
    addCity({ config_path: '/c/city.toml' }, { path: p });
    let s = loadSettings({ path: p });
    expect(s.cities.length).toBe(1);
    removeCity('/c/city.toml', { path: p });
    s = loadSettings({ path: p });
    expect(s.cities.length).toBe(0);
  });
});
