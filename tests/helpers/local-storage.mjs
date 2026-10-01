/**
 * A `localStorage` to run against.
 *
 * The drafts all live there, so testing them means replacing it, which is also
 * how a browser behaves when a page is not allowed to use storage - which is
 * why every one of those helpers catches. `removeItem` is here because a
 * finished draft removes its key rather than storing an empty value, and a
 * stub without it would make the clear look like it had worked.
 *
 * The map is handed to `run` so a test can plant a value the helpers never
 * wrote, which is the only way to check that corrupt storage is refused rather
 * than trusted.
 */
export function withLocalStorage(run) {
  const values = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (name) => values.get(name) ?? null,
      setItem: (name, value) => values.set(name, value),
      removeItem: (name) => values.delete(name),
      clear: () => values.clear(),
    },
  });
  try {
    return run(values);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
}