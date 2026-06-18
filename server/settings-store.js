import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { debug } from './logging.js';

const log = debug('settings-store');

/**
 * @typedef {Object} SettingsWorkspaceEntry
 * @property {string} path - Absolute path to a directory containing `.beads/`.
 * @property {string} [label] - Optional display label.
 */

/**
 * @typedef {Object} SettingsCityEntry
 * @property {string} config_path - Absolute path to a `city.toml` file.
 */

/**
 * @typedef {Object} SettingsDoc
 * @property {SettingsWorkspaceEntry[]} workspaces
 * @property {SettingsCityEntry[]} cities
 */

/**
 * Return an empty settings document.
 *
 * @returns {SettingsDoc}
 */
export function emptySettings() {
  return { workspaces: [], cities: [] };
}

/**
 * Resolve the path to the beads-ui settings file.
 * Honours XDG_CONFIG_HOME; falls back to ~/.config/beads-ui/settings.json,
 * then ~/.beads-ui/settings.json when `~/.config/` does not exist.
 *
 * @param {{ env?: Record<string, string | undefined>, homedir?: string }} [options]
 * @returns {string}
 */
export function getSettingsPath(options = {}) {
  const env = options.env || process.env;
  const home = options.homedir || os.homedir();
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) {
    return path.join(xdg, 'beads-ui', 'settings.json');
  }
  const xdg_default = path.join(home, '.config');
  try {
    if (fs.existsSync(xdg_default)) {
      return path.join(xdg_default, 'beads-ui', 'settings.json');
    }
  } catch {
    // ignore
  }
  return path.join(home, '.beads-ui', 'settings.json');
}

/**
 * Normalize an arbitrary parsed JSON value into a valid SettingsDoc.
 * Drops malformed entries silently.
 *
 * @param {unknown} value
 * @returns {SettingsDoc}
 */
export function normalizeSettings(value) {
  /** @type {SettingsDoc} */
  const out = emptySettings();
  if (!value || typeof value !== 'object') {
    return out;
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  if (Array.isArray(obj.workspaces)) {
    for (const w of obj.workspaces) {
      if (!w || typeof w !== 'object') continue;
      const wp = /** @type {Record<string, unknown>} */ (w).path;
      if (typeof wp !== 'string' || wp.length === 0) continue;
      const wl = /** @type {Record<string, unknown>} */ (w).label;
      /** @type {SettingsWorkspaceEntry} */
      const entry = { path: path.resolve(wp) };
      if (typeof wl === 'string' && wl.length > 0) {
        entry.label = wl;
      }
      out.workspaces.push(entry);
    }
  }
  if (Array.isArray(obj.cities)) {
    for (const c of obj.cities) {
      if (!c || typeof c !== 'object') continue;
      const cp = /** @type {Record<string, unknown>} */ (c).config_path;
      if (typeof cp !== 'string' || cp.length === 0) continue;
      out.cities.push({ config_path: path.resolve(cp) });
    }
  }
  return out;
}

/**
 * Load settings from disk. Returns the empty doc when the file is absent or
 * unreadable.
 *
 * @param {{ path?: string, env?: Record<string, string | undefined>, homedir?: string }} [options]
 * @returns {SettingsDoc}
 */
export function loadSettings(options = {}) {
  const file_path = options.path || getSettingsPath(options);
  try {
    if (!fs.existsSync(file_path)) {
      return emptySettings();
    }
    const raw = fs.readFileSync(file_path, 'utf8');
    /** @type {unknown} */
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (err) {
    log('failed to load settings from %s: %o', file_path, err);
    return emptySettings();
  }
}

/**
 * Persist settings to disk, creating intermediate directories as needed.
 *
 * @param {SettingsDoc} settings
 * @param {{ path?: string, env?: Record<string, string | undefined>, homedir?: string }} [options]
 */
export function saveSettings(settings, options = {}) {
  const file_path = options.path || getSettingsPath(options);
  const normalized = normalizeSettings(settings);
  const dir = path.dirname(file_path);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file_path,
    JSON.stringify(normalized, null, 2) + '\n',
    'utf8'
  );
  log('saved settings to %s', file_path);
}

/**
 * Add or replace a workspace entry (matched by absolute path) and persist.
 *
 * @param {SettingsWorkspaceEntry} entry
 * @param {{ path?: string, env?: Record<string, string | undefined>, homedir?: string }} [options]
 * @returns {SettingsDoc}
 */
export function addWorkspace(entry, options = {}) {
  const settings = loadSettings(options);
  const abs = path.resolve(entry.path);
  const idx = settings.workspaces.findIndex(
    (w) => path.resolve(w.path) === abs
  );
  /** @type {SettingsWorkspaceEntry} */
  const next = { path: abs };
  if (entry.label && entry.label.length > 0) {
    next.label = entry.label;
  }
  if (idx >= 0) {
    settings.workspaces[idx] = next;
  } else {
    settings.workspaces.push(next);
  }
  saveSettings(settings, options);
  return settings;
}

/**
 * Remove a workspace entry by absolute path and persist.
 *
 * @param {string} workspace_path
 * @param {{ path?: string, env?: Record<string, string | undefined>, homedir?: string }} [options]
 * @returns {SettingsDoc}
 */
export function removeWorkspace(workspace_path, options = {}) {
  const settings = loadSettings(options);
  const abs = path.resolve(workspace_path);
  settings.workspaces = settings.workspaces.filter(
    (w) => path.resolve(w.path) !== abs
  );
  saveSettings(settings, options);
  return settings;
}

/**
 * Add a city entry and persist.
 *
 * @param {SettingsCityEntry} entry
 * @param {{ path?: string, env?: Record<string, string | undefined>, homedir?: string }} [options]
 * @returns {SettingsDoc}
 */
export function addCity(entry, options = {}) {
  const settings = loadSettings(options);
  const abs = path.resolve(entry.config_path);
  if (!settings.cities.some((c) => path.resolve(c.config_path) === abs)) {
    settings.cities.push({ config_path: abs });
  }
  saveSettings(settings, options);
  return settings;
}

/**
 * Remove a city entry by absolute config path and persist.
 *
 * @param {string} city_config_path
 * @param {{ path?: string, env?: Record<string, string | undefined>, homedir?: string }} [options]
 * @returns {SettingsDoc}
 */
export function removeCity(city_config_path, options = {}) {
  const settings = loadSettings(options);
  const abs = path.resolve(city_config_path);
  settings.cities = settings.cities.filter(
    (c) => path.resolve(c.config_path) !== abs
  );
  saveSettings(settings, options);
  return settings;
}
