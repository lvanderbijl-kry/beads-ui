import { runBdJson } from './bd.js';
import { debug } from './logging.js';
import { resolveWorkspaces } from './workspace-registry.js';

const log = debug('list-adapters');

/**
 * @typedef {import('./workspace-registry.js').Workspace} Workspace
 */

/**
 * @typedef {{ id: string, updated_at: number, closed_at: number | null } & Record<string, unknown>} NormalizedIssue
 */

/**
 * Per-workspace fan-out result returned from fetchListAcrossWorkspaces.
 *
 * @typedef {Object} WorkspaceFetchResult
 * @property {Workspace} workspace
 * @property {true} ok
 * @property {NormalizedIssue[]} items
 *//**
 * @typedef {Object} WorkspaceFetchError
 * @property {Workspace} workspace
 * @property {false} ok
 * @property {{ code: string, message: string }} error
 */

/**
 * Build concrete `bd` CLI args for a subscription type + params.
 * Always includes `--json` for parseable output.
 *
 * @param {{ type: string, params?: Record<string, string | number | boolean> }} spec
 * @returns {string[]}
 */
export function mapSubscriptionToBdArgs(spec) {
  const t = String(spec.type);
  switch (t) {
    case 'all-issues': {
      return ['list', '--json', '--tree=false'];
    }
    case 'epics': {
      return ['epic', 'status', '--json'];
    }
    case 'blocked-issues': {
      return ['blocked', '--json'];
    }
    case 'ready-issues': {
      return ['ready', '--limit', '1000', '--json'];
    }
    case 'in-progress-issues': {
      return ['list', '--json', '--tree=false', '--status', 'in_progress'];
    }
    case 'closed-issues': {
      return [
        'list',
        '--json',
        '--tree=false',
        '--status',
        'closed',
        '--limit',
        '1000'
      ];
    }
    case 'issue-detail': {
      const p = spec.params || {};
      const id = String(p.id || '').trim();
      if (id.length === 0) {
        throw badRequest('Missing param: params.id');
      }
      return ['show', id, '--json'];
    }
    case 'epic-children': {
      const p = spec.params || {};
      const id = String(p.id || '').trim();
      if (id.length === 0) {
        throw badRequest('Missing param: params.id');
      }
      return ['children', id, '--json'];
    }
    default: {
      throw badRequest(`Unknown subscription type: ${t}`);
    }
  }
}

/**
 * Normalize bd list output to minimal Issue shape used by the registry.
 * - Ensures `id` is a string.
 * - Coerces timestamps to numbers.
 * - `closed_at` defaults to null when missing or invalid.
 *
 * @param {unknown} value
 * @returns {Array<{ id: string, created_at: number, updated_at: number, closed_at: number | null } & Record<string, unknown>>}
 */
export function normalizeIssueList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  /** @type {Array<{ id: string, created_at: number, updated_at: number, closed_at: number | null } & Record<string, unknown>>} */
  const out = [];
  for (const it of value) {
    const id = String(it.id ?? '');
    if (id.length === 0) {
      continue;
    }
    const created_at = parseTimestamp(/** @type {any} */ (it).created_at);
    const updated_at = parseTimestamp(it.updated_at);
    const closed_raw = it.closed_at;
    /** @type {number | null} */
    let closed_at = null;
    if (closed_raw !== undefined && closed_raw !== null) {
      const n = parseTimestamp(closed_raw);
      closed_at = Number.isFinite(n) ? n : null;
    }
    out.push({
      ...it,
      id,
      created_at: Number.isFinite(created_at) ? created_at : 0,
      updated_at: Number.isFinite(updated_at) ? updated_at : 0,
      closed_at
    });
  }
  return out;
}

/**
 * @typedef {Object} FetchListResultSuccess
 * @property {true} ok
 * @property {Array<{ id: string, updated_at: number, closed_at: number | null } & Record<string, unknown>>} items
 */

/**
 * @typedef {Object} FetchListResultFailure
 * @property {false} ok
 * @property {{ code: string, message: string, details?: Record<string, unknown> }} error
 */

/**
 * Execute the mapped `bd` command for a subscription spec and return normalized items.
 * Errors do not throw; they are surfaced as a structured object.
 *
 * @param {{ type: string, params?: Record<string, string | number | boolean> }} spec
 * @param {{ cwd?: string }} [options] - Optional working directory for bd command
 * @returns {Promise<FetchListResultSuccess | FetchListResultFailure>}
 */
export async function fetchListForSubscription(spec, options = {}) {
  /** @type {string[]} */
  let args;
  try {
    args = mapSubscriptionToBdArgs(spec);
  } catch (err) {
    // Surface bad requests (e.g., missing params)
    log('mapSubscriptionToBdArgs failed for %o: %o', spec, err);
    const e = toErrorObject(err);
    return { ok: false, error: e };
  }

  try {
    const res = await runBdJson(args, { cwd: options.cwd });
    if (!res || res.code !== 0 || !('stdoutJson' in res)) {
      log(
        'bd failed for %o (args=%o) code=%s stderr=%s',
        spec,
        args,
        res?.code,
        res?.stderr || ''
      );
      return {
        ok: false,
        error: {
          code: 'bd_error',
          message: String(res?.stderr || 'bd failed'),
          details: { exit_code: res?.code ?? -1 }
        }
      };
    }
    // bd show may return a single object; normalize to an array first
    let raw = Array.isArray(res.stdoutJson)
      ? res.stdoutJson
      : res.stdoutJson && typeof res.stdoutJson === 'object'
        ? [res.stdoutJson]
        : [];

    // Special-case mapping for `epics`: current bd output nests the epic under
    // an `epic` key and exposes counters at the top level. Flatten so that
    // each entry has a top-level `id` and core fields expected by the registry.
    if (String(spec.type) === 'epics') {
      raw = raw.map((it) => {
        if (it && typeof it === 'object' && 'epic' in it) {
          const e = /** @type {any} */ (it).epic || {};
          /** @type {Record<string, unknown>} */
          const flat = {
            // Required minimal fields for registry + client rendering
            id: String(e.id ?? ''),
            title: e.title,
            status: e.status,
            issue_type: e.issue_type || 'epic',
            created_at: e.created_at,
            updated_at: e.updated_at,
            closed_at: e.closed_at ?? null,
            deleted_at: e.deleted_at ?? null,
            // Preserve useful counters from bd output
            total_children: /** @type {any} */ (it).total_children,
            closed_children: /** @type {any} */ (it).closed_children,
            eligible_for_close: /** @type {any} */ (it).eligible_for_close
          };
          return flat;
        }
        return it;
      });
      raw = raw.filter((it) => {
        if (!it || typeof it !== 'object') {
          return false;
        }
        const status =
          typeof (/** @type {any} */ (it).status) === 'string'
            ? /** @type {any} */ (it).status
            : '';
        if (status === 'tombstone') {
          return false;
        }
        const deleted_at = /** @type {any} */ (it).deleted_at;
        if (deleted_at !== undefined && deleted_at !== null) {
          return false;
        }
        return true;
      });
    }

    const items = normalizeIssueList(raw);
    return { ok: true, items };
  } catch (err) {
    log('bd invocation failed for %o (args=%o): %o', spec, args, err);
    return {
      ok: false,
      error: {
        code: 'bd_error',
        message:
          (err && /** @type {any} */ (err).message) || 'bd invocation failed'
      }
    };
  }
}

/**
 * Create a `bad_request` error object.
 *
 * @param {string} message
 */
function badRequest(message) {
  const e = new Error(message);
  // @ts-expect-error add code
  e.code = 'bad_request';
  return e;
}

/**
 * Normalize arbitrary thrown values to a structured error object.
 *
 * @param {unknown} err
 * @returns {FetchListResultFailure['error']}
 */
function toErrorObject(err) {
  if (err && typeof err === 'object') {
    const any = /** @type {{ code?: unknown, message?: unknown }} */ (err);
    const code = typeof any.code === 'string' ? any.code : 'bad_request';
    const message =
      typeof any.message === 'string' ? any.message : 'Request error';
    return { code, message };
  }
  return { code: 'bad_request', message: 'Request error' };
}

/**
 * Tag every issue with a `_workspace` field referencing the workspace it came
 * from. Mutates each item in place and returns the array for convenience.
 *
 * @template {{ id: string } & Record<string, unknown>} T
 * @param {T[]} items
 * @param {Workspace} workspace
 * @returns {T[]}
 */
export function tagItemsWithWorkspace(items, workspace) {
  const tag = {
    path: workspace.path,
    label: workspace.label
  };
  for (const it of items) {
    /** @type {any} */ (it)._workspace = tag;
  }
  return items;
}

/**
 * Fan-out a subscription spec across multiple workspaces. Each workspace runs
 * its own `bd` invocation; failures are isolated per workspace.
 *
 * Returns a flat merged item array (each item tagged with `_workspace`) along
 * with the per-workspace status objects so the caller can surface warnings.
 *
 * @param {{ type: string, params?: Record<string, string|number|boolean> }} spec
 * @param {Workspace[]} workspaces
 * @returns {Promise<{ items: NormalizedIssue[], results: Array<WorkspaceFetchResult | WorkspaceFetchError> }>}
 */
export async function fetchListAcrossWorkspaces(spec, workspaces) {
  /** @type {Array<WorkspaceFetchResult | WorkspaceFetchError>} */
  const results = [];
  /** @type {NormalizedIssue[]} */
  const merged = [];

  for (const ws of workspaces) {
    try {
      const res = await fetchListForSubscription(spec, { cwd: ws.path });
      if (!res.ok) {
        log('workspace %s failed for %o: %s', ws.path, spec, res.error.message);
        results.push({ workspace: ws, ok: false, error: res.error });
        continue;
      }
      tagItemsWithWorkspace(res.items, ws);
      results.push({ workspace: ws, ok: true, items: res.items });
      for (const it of res.items) {
        merged.push(it);
      }
    } catch (err) {
      log('workspace %s threw for %o: %o', ws.path, spec, err);
      results.push({
        workspace: ws,
        ok: false,
        error: {
          code: 'bd_error',
          message:
            (err && /** @type {any} */ (err).message) || 'bd invocation failed'
        }
      });
    }
  }

  return { items: dedupeById(merged), results };
}

/**
 * Resolve the active workspace registry and fan a subscription out across all
 * resolved workspaces. Convenience wrapper used by the WS layer.
 *
 * @param {{ type: string, params?: Record<string, string|number|boolean> }} spec
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ items: NormalizedIssue[], results: Array<WorkspaceFetchResult | WorkspaceFetchError>, workspaces: Workspace[] }>}
 */
export async function fetchListForActiveWorkspaces(spec, options = {}) {
  let { workspaces } = resolveWorkspaces({ cwd: options.cwd });
  // Fallback: when nothing is configured, treat the supplied cwd as a single
  // implicit workspace so we still serve content (and keep the single-workspace
  // legacy flow working).
  if (workspaces.length === 0 && options.cwd) {
    const parts = String(options.cwd).split('/').filter(Boolean);
    workspaces = [
      {
        path: options.cwd,
        label: parts[parts.length - 1] || options.cwd,
        source: 'cwd'
      }
    ];
  }
  const { items, results } = await fetchListAcrossWorkspaces(spec, workspaces);
  return { items, results, workspaces };
}

/**
 * Drop duplicate items (by id) keeping the first occurrence. Detail
 * subscriptions across multiple workspaces would otherwise produce N copies of
 * the same id; the first wins (cwd → settings → city ordering).
 *
 * @template {{ id: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
function dedupeById(items) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {T[]} */
  const out = [];
  for (const it of items) {
    if (!it || typeof it.id !== 'string') continue;
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * Parse a bd timestamp string to epoch ms using Date.parse.
 * Falls back to numeric coercion when parsing fails.
 *
 * @param {unknown} v
 * @returns {number}
 */
function parseTimestamp(v) {
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) {
      return ms;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}
