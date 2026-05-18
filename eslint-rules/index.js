/**
 * Local ESLint plugin: deployment-mode
 *
 * Custom rules that enforce the deployment-mode contract documented in
 * .claude/plan/deployment-mode-flag-v2.md.
 *
 * Rules:
 *   - no-direct-macro: forbid direct __DEPLOYMENT_MODE__ /
 *     process.env.DEPLOYMENT_MODE access outside helper + hot-gate files.
 *
 * Wired into eslint.config.mjs as a plugin object (flat config).
 */

'use strict';

module.exports = {
  rules: {
    'no-direct-macro': require('./no-direct-macro'),
  },
};
