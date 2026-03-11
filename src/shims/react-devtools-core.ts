// Shim for react-devtools-core — not needed in production standalone binaries.
// This prevents runtime "Cannot find package" errors in bun-compiled executables.
// Ink's devtools.js calls .initialize() and .connectToDevTools() on the default export.
export default {
  initialize() {},
  connectToDevTools() {},
};
