import TOML from '@iarna/toml';
import fs from 'node:fs';
import path from 'node:path';
import { debug } from './logging.js';

const log = debug('city-toml');

/**
 * @typedef {Object} CityRig
 * @property {string} name - Rig name (required).
 * @property {string} [path] - Optional override; relative to the city dir.
 * @property {boolean} [suspended] - Suspended rigs are skipped during enumeration.
 */

/**
 * @typedef {Object} ParsedCity
 * @property {string} config_path - Absolute path to the city.toml file.
 * @property {string} city_dir - Absolute path to the directory containing the file.
 * @property {string} name - Display name (basename of the city dir).
 * @property {CityRig[]} rigs
 */

/**
 * Parse raw TOML text into a ParsedCity. Throws on malformed TOML or missing
 * required fields per rig.
 *
 * @param {string} text
 * @param {string} config_path - Absolute path to the source file (used for resolving rig paths).
 * @returns {ParsedCity}
 */
export function parseCityToml(text, config_path) {
  const abs_config = path.resolve(config_path);
  const city_dir = path.dirname(abs_config);
  const data = /** @type {Record<string, unknown>} */ (TOML.parse(text));
  /** @type {CityRig[]} */
  const rigs = [];
  const raw_rigs = data.rigs;
  if (Array.isArray(raw_rigs)) {
    for (const r of raw_rigs) {
      if (!r || typeof r !== 'object') continue;
      const obj = /** @type {Record<string, unknown>} */ (r);
      const name = obj.name;
      if (typeof name !== 'string' || name.length === 0) continue;
      /** @type {CityRig} */
      const rig = { name };
      if (typeof obj.path === 'string' && obj.path.length > 0) {
        rig.path = obj.path;
      }
      if (obj.suspended === true) {
        rig.suspended = true;
      }
      rigs.push(rig);
    }
  }
  return {
    config_path: abs_config,
    city_dir,
    name: path.basename(city_dir),
    rigs
  };
}

/**
 * Read and parse a city.toml file.
 *
 * @param {string} config_path - Absolute path to the city.toml file.
 * @returns {ParsedCity}
 */
export function loadCityToml(config_path) {
  const abs = path.resolve(config_path);
  const text = fs.readFileSync(abs, 'utf8');
  return parseCityToml(text, abs);
}

/**
 * @typedef {Object} CityWorkspace
 * @property {string} path - Absolute path to a directory containing `.beads/`.
 * @property {string} label - Display label.
 * @property {string} city_path - Originating city.toml path.
 * @property {'city'|'rig'} kind - Whether this is the city-level beads dir or a rig.
 */

/**
 * Enumerate workspace directories from a parsed city.
 * Includes:
 *   - `<city_dir>/.beads/` if present
 *   - `<rig.path or <city_dir>/<rig.name>>/.beads/` for each non-suspended rig
 *     that actually has a `.beads/` directory.
 *
 * @param {ParsedCity} city
 * @returns {CityWorkspace[]}
 */
export function enumerateCityWorkspaces(city) {
  /** @type {CityWorkspace[]} */
  const out = [];
  if (dirContainsBeads(city.city_dir)) {
    out.push({
      path: city.city_dir,
      label: city.name,
      city_path: city.config_path,
      kind: 'city'
    });
  }
  for (const rig of city.rigs) {
    if (rig.suspended) continue;
    const rig_dir = rig.path
      ? path.isAbsolute(rig.path)
        ? rig.path
        : path.join(city.city_dir, rig.path)
      : path.join(city.city_dir, rig.name);
    if (dirContainsBeads(rig_dir)) {
      out.push({
        path: rig_dir,
        label: rig.name,
        city_path: city.config_path,
        kind: 'rig'
      });
    }
  }
  return out;
}

/**
 * Try to load a city.toml file and enumerate its workspaces. Returns an empty
 * array on any error (file missing, parse failure, etc.).
 *
 * @param {string} config_path
 * @returns {{ city: ParsedCity | null, workspaces: CityWorkspace[], error: string | null }}
 */
export function loadAndEnumerate(config_path) {
  try {
    const city = loadCityToml(config_path);
    const workspaces = enumerateCityWorkspaces(city);
    return { city, workspaces, error: null };
  } catch (err) {
    const message =
      err && /** @type {any} */ (err).message
        ? String(/** @type {any} */ (err).message)
        : 'Failed to load city.toml';
    log('loadAndEnumerate failed for %s: %o', config_path, err);
    return { city: null, workspaces: [], error: message };
  }
}

/**
 * @param {string} dir
 */
function dirContainsBeads(dir) {
  try {
    const beads = path.join(dir, '.beads');
    const stat = fs.statSync(beads);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
