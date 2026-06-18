import fs from 'node:fs';
import path from 'node:path';
import { debug } from './logging.js';
import { resolveWorkspaces } from './workspace-registry.js';

const log = debug('multi-watcher');

/**
 * Watch every `.beads/` directory in the active workspace registry plus every
 * `city.toml` file referenced from settings.
 *
 * Emits two callbacks:
 *   - `onBeadsChange()` when any workspace's `.beads/` contents change. Used to
 *     trigger a refresh of active list subscriptions.
 *   - `onCityChange()` when a `city.toml` file changes or when settings.json is
 *     rewritten. Triggers a workspace re-resolution.
 *
 * @param {{ onBeadsChange: () => void, onCityChange: () => void, cwd?: string, debounce_ms?: number }} options
 * @returns {{ close: () => void, rebind: () => void, paths: () => { beads: string[], cities: string[] } }}
 */
export function createMultiWatcher(options) {
  const debounce_ms = options.debounce_ms ?? 250;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let beads_timer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let city_timer = null;
  /** @type {fs.FSWatcher[]} */
  let beads_watchers = [];
  /** @type {fs.FSWatcher[]} */
  let city_watchers = [];
  /** @type {string[]} */
  let beads_paths = [];
  /** @type {string[]} */
  let city_paths = [];

  function scheduleBeads() {
    if (beads_timer) clearTimeout(beads_timer);
    beads_timer = setTimeout(() => {
      beads_timer = null;
      try {
        options.onBeadsChange();
      } catch (err) {
        log('onBeadsChange threw: %o', err);
      }
    }, debounce_ms);
    beads_timer.unref?.();
  }

  function scheduleCity() {
    if (city_timer) clearTimeout(city_timer);
    city_timer = setTimeout(() => {
      city_timer = null;
      try {
        options.onCityChange();
      } catch (err) {
        log('onCityChange threw: %o', err);
      }
    }, debounce_ms);
    city_timer.unref?.();
  }

  function closeAll() {
    for (const w of beads_watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    for (const w of city_watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    beads_watchers = [];
    city_watchers = [];
    beads_paths = [];
    city_paths = [];
  }

  function bind() {
    closeAll();
    const { workspaces, cities } = resolveWorkspaces({ cwd: options.cwd });
    for (const w of workspaces) {
      const beads_dir = path.join(w.path, '.beads');
      try {
        const watcher = fs.watch(
          beads_dir,
          { persistent: true },
          (event_type) => {
            if (event_type === 'change' || event_type === 'rename') {
              scheduleBeads();
            }
          }
        );
        beads_watchers.push(watcher);
        beads_paths.push(beads_dir);
      } catch (err) {
        log('failed to watch %s: %o', beads_dir, err);
      }
    }
    for (const city of cities) {
      const dir = path.dirname(city.config_path);
      const file = path.basename(city.config_path);
      try {
        const watcher = fs.watch(
          dir,
          { persistent: true },
          (event_type, filename) => {
            if (filename && String(filename) !== file) return;
            if (event_type === 'change' || event_type === 'rename') {
              scheduleCity();
            }
          }
        );
        city_watchers.push(watcher);
        city_paths.push(city.config_path);
      } catch (err) {
        log('failed to watch %s: %o', city.config_path, err);
      }
    }
  }

  bind();

  return {
    close() {
      if (beads_timer) clearTimeout(beads_timer);
      if (city_timer) clearTimeout(city_timer);
      closeAll();
    },
    rebind() {
      bind();
    },
    paths() {
      return { beads: beads_paths.slice(), cities: city_paths.slice() };
    }
  };
}
