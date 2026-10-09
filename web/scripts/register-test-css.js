// Node's React renderer has no CSS pipeline. Preserve module class lookups
// while leaving visual/style validation to the browser checks.
require.extensions['.css'] = function registerCssModule(module) {
  module.exports = { __esModule: true, default: new Proxy({}, { get: (_, className) => className }) };
};
