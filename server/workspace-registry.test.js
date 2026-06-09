import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { saveSettings } from './settings-store.js';
import { resolveWorkspaces } from './workspace-registry.js';

/** @type {string[]} */
const tmps = [];

function mkdtemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-reg-'));
  tmps.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmps.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

/**
 * Make a workspace directory with a .beads/ subdir.
 *
 * @param {string} root
 * @param {string} name
 */
function mkWorkspace(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.beads'), { recursive: true });
  return dir;
}

describe('resolveWorkspaces', () => {
  test('includes cwd when it has .beads/', () => {
    const dir = mkdtemp();
    const ws = mkWorkspace(dir, 'a');
    const settings_path = path.join(dir, 'settings.json');
    saveSettings({ workspaces: [], cities: [] }, { path: settings_path });
    const reg = resolveWorkspaces({ cwd: ws, settings_path });
    expect(reg.workspaces.length).toBe(1);
    expect(reg.workspaces[0].source).toBe('cwd');
  });

  test('settings entries with no .beads/ are skipped', () => {
    const dir = mkdtemp();
    const settings_path = path.join(dir, 'settings.json');
    const ghost = path.join(dir, 'nonexistent');
    saveSettings(
      { workspaces: [{ path: ghost }], cities: [] },
      { path: settings_path }
    );
    const reg = resolveWorkspaces({ cwd: dir, settings_path });
    expect(reg.workspaces.length).toBe(0);
  });

  test('dedupes by abs path with precedence cwd > settings > city', () => {
    const dir = mkdtemp();
    const a = mkWorkspace(dir, 'a');
    const b = mkWorkspace(dir, 'b');
    // Make a city.toml that points to both a and b
    const city_path = path.join(dir, 'city.toml');
    fs.writeFileSync(city_path, `[[rigs]]\nname = "a"\n[[rigs]]\nname = "b"\n`);
    const settings_path = path.join(dir, 'settings.json');
    saveSettings(
      {
        workspaces: [{ path: a, label: 'A-from-settings' }],
        cities: [{ config_path: city_path }]
      },
      { path: settings_path }
    );
    const reg = resolveWorkspaces({ cwd: b, settings_path });
    expect(reg.workspaces.length).toBe(2);
    const a_entry = reg.workspaces.find((w) => w.path === a);
    const b_entry = reg.workspaces.find((w) => w.path === b);
    expect(a_entry?.source).toBe('settings');
    expect(a_entry?.label).toBe('A-from-settings');
    expect(b_entry?.source).toBe('cwd');
  });

  test('emits city status with error for unreadable city.toml', () => {
    const dir = mkdtemp();
    const settings_path = path.join(dir, 'settings.json');
    saveSettings(
      {
        workspaces: [],
        cities: [{ config_path: '/no/such/city.toml' }]
      },
      { path: settings_path }
    );
    const reg = resolveWorkspaces({ cwd: dir, settings_path });
    expect(reg.cities.length).toBe(1);
    expect(reg.cities[0].error).toBeTruthy();
    expect(reg.cities[0].workspace_count).toBe(0);
  });
});
