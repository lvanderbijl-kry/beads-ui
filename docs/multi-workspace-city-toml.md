# Multi-Workspace Support + gascity `city.toml` Integration

```
Date: 2026-06-05
Status: Proposed
Owner: lvanderbijl
```

## Motivation

Today beads-ui binds to a single `.beads/` directory resolved from the cwd of
`bdui start`. That works for one repo, but breaks down when a user works inside
a gascity "city" — a directory tree containing many rigs (repos), each with its
own `.beads/`, plus an optional city-level `.beads/` and a `city.toml` that
declares the rigs.

We want beads-ui to:

1. Show issues from **multiple** `.beads/` stores at once (aggregated views with
   per-workspace badges and filters).
2. Discover those stores automatically from a `city.toml` file.
3. Be usable when there's no `.beads/` under the cwd (empty-state + Settings
   page to add stores explicitly).

## Inputs

- `city.toml` schema (from gascity): `[[rigs]]` with `name` (required) and
  `path` (optional, defaults to `<city>/<name>/`). Sample at
  `~/kry/code/gascity/edna/city.toml`.
- Beads dirs in a city: `<city>/.beads/` plus, for each rig with one,
  `<rig.path or city/rig.name>/.beads/`.

## Decisions (locked in)

| Decision                            | Choice                                                          |
| ----------------------------------- | --------------------------------------------------------------- |
| Delivery                            | One PR (no staging)                                             |
| TOML parser                         | `@iarna/toml` (new runtime dep)                                 |
| Mutation routing in aggregated mode | Always require explicit workspace choice                        |
| Holistic view shape                 | Aggregated lists with workspace badges (not per-workspace tabs) |

## Design

### Settings file

Path: `~/.config/beads-ui/settings.json` (XDG-style; fall back to
`~/.beads-ui/settings.json` if `XDG_CONFIG_HOME` and `~/.config/` are absent).

Shape:

```json
{
  "workspaces": [{ "path": "/abs/path/to/edna/meeting", "label": "meeting" }],
  "cities": [{ "config_path": "/abs/path/to/edna/city.toml" }]
}
```

- `workspaces[].path` is an absolute path to a directory containing `.beads/`.
- `workspaces[].label` is an optional display label; defaults to the directory
  basename.
- `cities[].config_path` is an absolute path to a `city.toml`.

The server reads and writes this file. The UI mutates it only through Settings
page RPCs.

### Workspace resolution

At startup and whenever settings change, the server merges three sources into
one deduplicated list, keyed by the absolute path of each `.beads/` directory:

1. **cwd auto-discovery** — today's behaviour: if `bdui` was started inside a
   directory containing `.beads/`, include it. Marked as `source: "cwd"`.
2. **Explicit `workspaces[]`** — every entry whose `<path>/.beads/` exists.
   Marked as `source: "settings"`.
3. **Cities** — for each `cities[].config_path`, parse the TOML and enumerate
   `<city>/.beads/` plus `<rig.path or city/rig.name>/.beads/` for every rig
   that isn't `suspended`. Marked as `source: "city"` with the originating
   `city_path` retained.

Dedup tiebreak: `cwd` > `settings` > `city`. Labels prefer the most explicit
source (settings label wins over city-derived label).

Each resolved workspace has the shape:

```ts
type Workspace = {
  path: string; // abs path to dir containing .beads/
  label: string;
  source: 'cwd' | 'settings' | 'city';
  city_path?: string; // present iff source === 'city'
};
```

### Empty state

If the merged workspace list is empty, the SPA renders a friendly empty state
that links to `#/settings`. The Settings page is reachable even when no
workspace is configured.

### Aggregated views

For every list subscription (`all-issues`, `epics`, `ready-issues`, board
columns, etc.), the server fans `bd` out across all active workspaces and merges
the results before pushing.

- Each issue gains a `_workspace: { path, label }` field on the wire.
- Subscription `revision` semantics are unchanged — the server is the single
  source of truth for ordering.
- Per-workspace error isolation: if one workspace's `bd` call fails, emit a
  warning chip for that workspace; do not drop the whole list.

### UI badges and filtering

- Issue rows render a small workspace badge (right-aligned, just before status).
  Clicking it filters to just that workspace.
- The filter bar gains a multi-select "Workspace" facet, default = all.
- The badge is hidden when only one workspace is active.

### ID collisions

beads IDs (`UI-42`, `MED-7`, …) are not globally unique across workspaces.

- The internal registry keys issues by `${workspace.path}::${id}`.
- User-visible rendering uses the bare ID. When the same ID exists in more than
  one active workspace, the badge becomes mandatory disambiguation; the detail
  dialog opens scoped to the workspace the row came from.

### Mutations

Every issue in the UI carries `_workspace`, so edits/closes/etc. dispatch `bd`
in the matching cwd.

For **new issues**, the dialog requires an explicit workspace choice (no
default). The dropdown is populated from the active workspace list; if there is
exactly one, the dropdown is still shown but pre-selected.

### Watcher

`server/watcher.js` becomes a multi-watcher: one watcher per active `.beads/`.
On any change it broadcasts `workspace-changed` with the affected workspace
path; existing subscriptions re-fan-out as today.

The watcher also watches each `cities[].config_path`. On change, re-parse and
re-resolve workspaces; emit `workspaces-updated` to the SPA.

### Settings page

New route at `#/settings`. Sections:

1. **Workspaces** — table of resolved workspaces (path, label, source). For
   `settings` rows: rename label, remove. For `cwd` / `city` rows: read-only,
   with a hint about where they came from.
2. **Cities** — list of `cities[]` entries with add/remove. Adding validates
   that the file exists and parses.
3. **Add workspace by path** — manual entry; validates that `<path>/.beads/`
   exists.

Settings mutations go over the existing WS connection (new RPCs: `settings-get`,
`settings-add-workspace`, `settings-remove-workspace`, `settings-add-city`,
`settings-remove-city`).

## Out of scope

- Authentication, remote access, multi-user concurrency — unchanged from the
  single-workspace design.
- Cross-workspace dependency graphs (e.g. a `dep` linking `MED-3` → `VIEW-12`).
  Beads doesn't support cross-store deps today; we won't fake it.
- Editing `city.toml` from the UI.
- Importing/migrating issues between workspaces.

## Implementation breakdown

Mapped to the bd epic + children created alongside this doc.

1. **Settings store + persistence** — read/write
   `~/.config/beads-ui/settings.json`; schema validation; default empty doc.
2. **`city.toml` parser + workspace enumeration** — `@iarna/toml` dep; resolve
   rigs to beads dirs; handle missing/suspended rigs.
3. **Unified workspace registry** — merge cwd/settings/cities; dedup;
   label-resolution; expose to the rest of the server.
4. **Subscription fan-out across workspaces** — per-list workers; merge + stable
   ordering; `_workspace` field on every issue.
5. **Mutation routing by workspace** — every handler that runs `bd` reads
   `_workspace` from the request and sets `cwd` accordingly.
6. **Settings page UI** — `#/settings` route, table view, add/remove flows,
   validation feedback.
7. **Empty state + onboarding** — empty-list message, "Open Settings" CTA,
   first-run hint.
8. **Workspace badge + filter in list views** — badge chip, filter facet, hide
   when only one workspace is active.
9. **Multi-watcher for `.beads/` dirs + `city.toml`** — extend `watchDb`;
   broadcast `workspaces-updated` on city changes.
10. **Tests for new modules + integration** — unit tests for parser, registry,
    settings store; integration test that boots with a sample `city.toml` and
    verifies aggregated push.

## References

- gascity `city.toml` sample: `~/kry/code/gascity/edna/city.toml`
- Existing single-workspace behaviour: `server/config.js`, `server/db.js`,
  `server/watcher.js`
- Push protocol (subscription mechanics unchanged):
  `docs/protocol/issues-push-v2.md`
