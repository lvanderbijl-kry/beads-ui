import { html, render } from 'lit-html';
import { debug } from '../utils/logging.js';
import { showToast } from '../utils/toast.js';

/**
 * Settings page: manage workspaces and city.toml entries.
 *
 * @param {HTMLElement} mount_element
 * @param {(type: string, payload?: unknown) => Promise<unknown>} sendFn
 * @returns {{ load: () => Promise<void>, destroy: () => void }}
 */
export function createSettingsView(mount_element, sendFn) {
  const log = debug('views:settings');
  /** @type {{ workspaces: Array<{ path: string, label: string, source: string, city_path?: string }>, cities: Array<{ config_path: string, error: string | null, workspace_count: number }> } | null} */
  let registry = null;
  /** @type {string} */
  let add_workspace_path = '';
  /** @type {string} */
  let add_workspace_label = '';
  /** @type {string} */
  let add_city_path = '';
  /** @type {string} */
  let validation_error = '';

  async function loadRegistry() {
    try {
      registry = /** @type {any} */ (
        await sendFn('list-workspaces-resolved', {})
      );
    } catch (err) {
      log('failed to load registry: %o', err);
      registry = { workspaces: [], cities: [] };
    }
    doRender();
  }

  async function addWorkspace() {
    validation_error = '';
    const path = add_workspace_path.trim();
    if (!path) {
      validation_error = 'Path is required';
      doRender();
      return;
    }
    try {
      await sendFn('settings-add-workspace', {
        path,
        label: add_workspace_label.trim() || undefined
      });
      add_workspace_path = '';
      add_workspace_label = '';
      showToast('Workspace added', 'success', 2000);
      await loadRegistry();
    } catch (err) {
      validation_error =
        (err && /** @type {any} */ (err).message) || 'Failed to add workspace';
      doRender();
    }
  }

  /**
   * @param {string} workspace_path
   */
  async function removeWorkspace(workspace_path) {
    try {
      await sendFn('settings-remove-workspace', { path: workspace_path });
      showToast('Workspace removed', 'success', 2000);
      await loadRegistry();
    } catch (err) {
      showToast(
        (err && /** @type {any} */ (err).message) || 'Failed to remove',
        'error',
        3000
      );
    }
  }

  async function addCity() {
    validation_error = '';
    const config_path = add_city_path.trim();
    if (!config_path) {
      validation_error = 'city.toml path is required';
      doRender();
      return;
    }
    try {
      await sendFn('settings-add-city', { config_path });
      add_city_path = '';
      showToast('City added', 'success', 2000);
      await loadRegistry();
    } catch (err) {
      validation_error =
        (err && /** @type {any} */ (err).message) || 'Failed to add city';
      doRender();
    }
  }

  /**
   * @param {string} config_path
   */
  async function removeCity(config_path) {
    try {
      await sendFn('settings-remove-city', { config_path });
      showToast('City removed', 'success', 2000);
      await loadRegistry();
    } catch (err) {
      showToast(
        (err && /** @type {any} */ (err).message) || 'Failed to remove',
        'error',
        3000
      );
    }
  }

  function template() {
    const r = registry || { workspaces: [], cities: [] };
    return html`
      <section class="settings-page">
        <h2>Settings</h2>

        <section class="settings-section">
          <h3>Workspaces</h3>
          <p class="settings-help">
            Beads stores discovered from the current directory, explicit
            entries, and configured cities. All active workspaces appear in
            aggregated views with a badge.
          </p>
          ${r.workspaces.length === 0
            ? html`<p class="empty-state">No workspaces configured.</p>`
            : html`<table class="settings-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Path</th>
                    <th>Source</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${r.workspaces.map(
                    (w) =>
                      html`<tr>
                        <td>${w.label}</td>
                        <td class="mono">${w.path}</td>
                        <td>
                          <span class="source-chip source-${w.source}">
                            ${w.source}${w.source === 'city' && w.city_path
                              ? html` <span class="city-hint"
                                  >· ${shortPath(w.city_path)}</span
                                >`
                              : ''}
                          </span>
                        </td>
                        <td>
                          ${w.source === 'settings'
                            ? html`<button
                                type="button"
                                class="btn btn-sm"
                                @click=${() => removeWorkspace(w.path)}
                              >
                                Remove
                              </button>`
                            : ''}
                        </td>
                      </tr>`
                  )}
                </tbody>
              </table>`}

          <h4>Add workspace by path</h4>
          <div class="settings-form-row">
            <input
              type="text"
              placeholder="/abs/path/to/project"
              .value=${add_workspace_path}
              @input=${(/** @type {InputEvent} */ ev) => {
                const t = /** @type {HTMLInputElement} */ (ev.target);
                add_workspace_path = t.value;
              }}
            />
            <input
              type="text"
              placeholder="Label (optional)"
              .value=${add_workspace_label}
              @input=${(/** @type {InputEvent} */ ev) => {
                const t = /** @type {HTMLInputElement} */ (ev.target);
                add_workspace_label = t.value;
              }}
            />
            <button type="button" class="btn" @click=${addWorkspace}>
              Add
            </button>
          </div>
        </section>

        <section class="settings-section">
          <h3>Cities</h3>
          <p class="settings-help">
            Each <code>city.toml</code> is parsed and its rigs enumerated for
            beads stores.
          </p>
          ${r.cities.length === 0
            ? html`<p class="empty-state">No cities configured.</p>`
            : html`<table class="settings-table">
                <thead>
                  <tr>
                    <th>city.toml</th>
                    <th>Status</th>
                    <th>Workspaces</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${r.cities.map(
                    (c) =>
                      html`<tr>
                        <td class="mono">${c.config_path}</td>
                        <td>
                          ${c.error
                            ? html`<span class="status-error" title=${c.error}
                                >Error</span
                              >`
                            : html`<span class="status-ok">OK</span>`}
                        </td>
                        <td>${c.workspace_count}</td>
                        <td>
                          <button
                            type="button"
                            class="btn btn-sm"
                            @click=${() => removeCity(c.config_path)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>`
                  )}
                </tbody>
              </table>`}

          <h4>Add city.toml</h4>
          <div class="settings-form-row">
            <input
              type="text"
              placeholder="/abs/path/to/city.toml"
              .value=${add_city_path}
              @input=${(/** @type {InputEvent} */ ev) => {
                const t = /** @type {HTMLInputElement} */ (ev.target);
                add_city_path = t.value;
              }}
            />
            <button type="button" class="btn" @click=${addCity}>Add</button>
          </div>
        </section>

        ${validation_error
          ? html`<p class="validation-error">${validation_error}</p>`
          : ''}
      </section>
    `;
  }

  function doRender() {
    render(template(), mount_element);
  }

  /**
   * @param {string} p
   */
  function shortPath(p) {
    if (!p) return '';
    const parts = p.split('/').filter(Boolean);
    if (parts.length <= 3) return p;
    return '…/' + parts.slice(-3).join('/');
  }

  return {
    async load() {
      doRender();
      await loadRegistry();
    },
    destroy() {
      render(html``, mount_element);
    }
  };
}
