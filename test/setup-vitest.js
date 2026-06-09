/* global console, window */
// Suppress Lit dev-mode warning in Vitest
// Provided snippet: overrides console.warn but forwards all other messages
const { warn } = console;
console.warn = /** @type {function(...*): void} */ (
  (...args) => {
    // Filter out the noisy Lit dev-mode banner in tests
    if (!args[0].startsWith('Lit is in dev mode.')) {
      warn.call(console, ...args);
    }
  }
);

// jsdom v27 no longer provides localStorage unless --localstorage-file is set.
// Provide an in-memory polyfill so the app's persistence layer works in tests.
if (typeof window !== 'undefined' && !window.localStorage) {
  const make_storage = () => {
    const store = new Map();
    return {
      get length() {
        return store.size;
      },
      key(i) {
        return Array.from(store.keys())[i] ?? null;
      },
      getItem(k) {
        return store.has(String(k)) ? store.get(String(k)) : null;
      },
      setItem(k, v) {
        store.set(String(k), String(v));
      },
      removeItem(k) {
        store.delete(String(k));
      },
      clear() {
        store.clear();
      }
    };
  };
  Object.defineProperty(window, 'localStorage', {
    value: make_storage(),
    configurable: true
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: make_storage(),
    configurable: true
  });
}
