import fs from 'node:fs';
import path from 'node:path';
import { loadAndEnumerate } from './city-toml.js';
import { debug } from './logging.js';
import { loadSettings } from './settings-store.js';

const log = debug('workspace-registry');

/**
 * @typedef {'cwd'|'settings'|'city'} WorkspaceSource
 */

/**
 * @typedef {Object} Workspace
 * @property {string} path - Absolute path to the directory containing `.beads/`.
 * @property {string} label - Display label.
 * @property {WorkspaceSource} source - Origin of this entry.
 * @property {string} [city_path] - When source === 'city', the originating city.toml.
 */

/**
 * @typedef {Object} CityStatus
 * @property {string} config_path
 * @property {string | null} error
 * @property {number} workspace_count
 */

/**
 * @typedef {Object} ResolvedRegistry
 * @property {Workspace[]} workspaces
 * @property {CityStatus[]} cities
 */

/**
 * @param {string} workspace_path
 */
function hasBeadsDir(workspace_path) {
  try {
    return fs.statSync(path.join(workspace_path, '.beads')).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Derive a sensible default label from a path (the directory basename).
 *
 * @param {string} workspace_path
 */
function defaultLabel(workspace_path) {
  const base = path.basename(workspace_path);
  return base.length > 0 ? base : workspace_path;
}

/**
 * Resolve the unified workspace list by merging cwd auto-discovery, explicit
 * settings entries, and rigs enumerated from each city.toml. Deduplicated by
 * absolute workspace path with the precedence cwd > settings > city.
 *
 * @param {{ cwd?: string, settings_path?: string }} [options]
 * @returns {ResolvedRegistry}
 */
export function resolveWorkspaces(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  /** @type {Map<string, Workspace>} */
  const by_path = new Map();

  // 1) cwd auto-discovery
  if (hasBeadsDir(cwd)) {
    by_path.set(cwd, {
      path: cwd,
      label: defaultLabel(cwd),
      source: 'cwd'
    });
  }

  const settings = loadSettings(
    options.settings_path ? { path: options.settings_path } : undefined
  );

  // 2) explicit settings workspaces
  for (const entry of settings.workspaces) {
    const abs = path.resolve(entry.path);
    if (!hasBeadsDir(abs)) {
      log('skipping settings workspace without .beads/: %s', abs);
      continue;
    }
    if (by_path.has(abs)) {
      // cwd wins on path; but adopt the explicit label if cwd entry has none
      const existing = /** @type {Workspace} */ (by_path.get(abs));
      if (entry.label && entry.label.length > 0) {
        existing.label = entry.label;
      }
      continue;
    }
    by_path.set(abs, {
      path: abs,
      label:
        entry.label && entry.label.length > 0 ? entry.label : defaultLabel(abs),
      source: 'settings'
    });
  }

  // 3) cities
  /** @type {CityStatus[]} */
  const cities = [];
  for (const city_entry of settings.cities) {
    const abs_city = path.resolve(city_entry.config_path);
    const { city, workspaces, error } = loadAndEnumerate(abs_city);
    cities.push({
      config_path: abs_city,
      error,
      workspace_count: city ? workspaces.length : 0
    });
    for (const w of workspaces) {
      const abs = path.resolve(w.path);
      if (by_path.has(abs)) {
        // Lower precedence — leave existing entry alone.
        continue;
      }
      by_path.set(abs, {
        path: abs,
        label: w.label,
        source: 'city',
        city_path: abs_city
      });
    }
  }

  return {
    workspaces: Array.from(by_path.values()),
    cities
  };
}

/**
 * Find a workspace by absolute path.
 *
 * @param {ResolvedRegistry} registry
 * @param {string} workspace_path
 * @returns {Workspace | null}
 */
export function findWorkspace(registry, workspace_path) {
  const abs = path.resolve(workspace_path);
  for (const w of registry.workspaces) {
    if (path.resolve(w.path) === abs) {
      return w;
    }
  }
  return null;
}
