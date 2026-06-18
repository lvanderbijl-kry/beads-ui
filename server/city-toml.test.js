import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  enumerateCityWorkspaces,
  loadAndEnumerate,
  loadCityToml,
  parseCityToml
} from './city-toml.js';

/** @type {string[]} */
const tmps = [];

function mkdtemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-city-'));
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

describe('parseCityToml', () => {
  test('parses rigs with name + optional path/suspended', () => {
    const text = `
[[rigs]]
name = "one"

[[rigs]]
name = "two"
path = "../somewhere"

[[rigs]]
name = "three"
suspended = true
`;
    const city = parseCityToml(text, '/tmp/x/city.toml');
    expect(city.config_path).toBe('/tmp/x/city.toml');
    expect(city.city_dir).toBe('/tmp/x');
    expect(city.rigs.length).toBe(3);
    expect(city.rigs[1].path).toBe('../somewhere');
    expect(city.rigs[2].suspended).toBe(true);
  });

  test('drops rigs without a name', () => {
    const text = `
[[rigs]]
path = "x"
`;
    const city = parseCityToml(text, '/tmp/x/city.toml');
    expect(city.rigs.length).toBe(0);
  });
});

describe('loadCityToml', () => {
  test('reads + parses an on-disk file', () => {
    const dir = mkdtemp();
    const file = path.join(dir, 'city.toml');
    fs.writeFileSync(file, '[[rigs]]\nname = "a"\n');
    const city = loadCityToml(file);
    expect(city.rigs[0].name).toBe('a');
  });
});

describe('enumerateCityWorkspaces', () => {
  test('includes city.beads when present and skips rigs without .beads', () => {
    const dir = mkdtemp();
    fs.mkdirSync(path.join(dir, '.beads'));
    fs.mkdirSync(path.join(dir, 'meeting', '.beads'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'city.toml'), '');

    const city = parseCityToml(
      `
[[rigs]]
name = "meeting"

[[rigs]]
name = "orders"

[[rigs]]
name = "suspended-rig"
suspended = true
`,
      path.join(dir, 'city.toml')
    );
    const ws = enumerateCityWorkspaces(city);
    const paths = ws.map((w) => w.path).sort();
    expect(paths).toEqual([dir, path.join(dir, 'meeting')].sort());
    expect(ws.find((w) => w.kind === 'city')).toBeTruthy();
  });

  test('honours rig.path override (relative)', () => {
    const dir = mkdtemp();
    fs.mkdirSync(path.join(dir, 'sub', 'custom', '.beads'), {
      recursive: true
    });
    fs.writeFileSync(path.join(dir, 'city.toml'), '');
    const city = parseCityToml(
      `[[rigs]]\nname = "x"\npath = "sub/custom"\n`,
      path.join(dir, 'city.toml')
    );
    const ws = enumerateCityWorkspaces(city);
    expect(ws.length).toBe(1);
    expect(ws[0].path).toBe(path.join(dir, 'sub', 'custom'));
  });
});

describe('loadAndEnumerate', () => {
  test('returns error for missing file', () => {
    const res = loadAndEnumerate('/does/not/exist/city.toml');
    expect(res.error).toBeTruthy();
    expect(res.city).toBe(null);
    expect(res.workspaces).toEqual([]);
  });

  test('returns workspaces on success', () => {
    const dir = mkdtemp();
    fs.mkdirSync(path.join(dir, '.beads'));
    fs.writeFileSync(path.join(dir, 'city.toml'), '');
    const res = loadAndEnumerate(path.join(dir, 'city.toml'));
    expect(res.error).toBe(null);
    expect(res.workspaces.length).toBe(1);
  });
});
