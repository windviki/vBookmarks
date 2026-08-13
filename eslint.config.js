// eslint flat config (v8.57 via ESLINT_USE_FLAT_CONFIG=true, or eslint v9+).
// The extension is plain ES6+ with browser + MV3 service-worker globals; the
// tests run under vitest. Only error-level, high-signal rules in the first
// pass — style rules intentionally omitted (the repo has no lint history).
// See AGENTS.md (Test infrastructure) for the rule policy.
const globals = require('globals');
const vitest = require('eslint-plugin-vitest');

module.exports = [
    {
        ignores: [
            'node_modules/**', 'vendor/**', 'tmp/**', 'donation/**', 'assets/**',
            '_locales/**', 'scripts/**', 'docs/**', 'examples/**', 'features/**',
            'tasks/**', 'outputs/**', 'logs/**', 'prompts/**', 'schemas/**',
            '.git/**', '.github/**', '.claude/**', 'package-lock.json'
        ]
    },
    // Runtime: popup/panel/options pages + the MV3 service worker.
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.worker,
                chrome: 'readonly', // extension API (all contexts)
                OffscreenCanvas: 'readonly',
                Intl: 'readonly',
                // page globals exposed by src/store.js (a classic script)
                store: 'readonly',
                getSetting: 'readonly',
                setSetting: 'readonly',
                removeSetting: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-extra-boolean-cast': 'error'
        }
    },
    // Tests: node + vitest globals, plus the vitest recommended practices.
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.vitest,
                // the tests stub page globals on globalThis and then use the
                // bare identifiers; declare the handful they touch
                document: 'readonly',
                window: 'readonly',
                location: 'readonly',
                screen: 'readonly',
                navigator: 'readonly',
                chrome: 'readonly',
                VBMSort: 'readonly'
            }
        },
        plugins: { vitest },
        rules: {
            ...vitest.configs.recommended.rules,
            'no-undef': 'error',
            // vitest's expect(actual, message) is valid — the 2nd arg is a
            // custom failure message (the suite uses it widely)
            'vitest/valid-expect': ['error', { maxArgs: 2 }],
            // assertion helpers that assert internally (used across the CSS
            // contract suites); tests calling them DO have assertions
            'vitest/expect-expect': ['error', {
                assertFunctionNames: ['expect', 'assertProps', 'ruleBody', 'zIndexOf', 'extractBlock', 'assert']
            }]
        }
    }
];
