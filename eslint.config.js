import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';

// GJS globals. `eslint-config-gjs` and `eslint-plugin-gjs` were both last
// published in 2022 and fail our maintenance bar, so the globals are declared
// here rather than pulled from an unmaintained package.
//
// This list is deliberately not `globals.browser`. GJS is not a browser: it has
// no document, no localStorage, no fetch and no DOM. Declaring the browser set
// tells ESLint those names are defined, so a typo that reaches for one is
// accepted silently and fails only at runtime inside the Shell.
const gjsGlobals = {
    ARGV: 'readonly',
    imports: 'readonly',
    globalThis: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    pkg: 'readonly',
    _: 'readonly',
    C_: 'readonly',
    N_: 'readonly',

    // Provided by GJS itself rather than by any gi:// import.
    console: 'readonly',
    setTimeout: 'readonly',
    setInterval: 'readonly',
    clearTimeout: 'readonly',
    clearInterval: 'readonly',
    queueMicrotask: 'readonly',
    structuredClone: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
};

export default [
    { ignores: ['node_modules/', 'coverage/', 'schemas/'] },
    js.configs.recommended,
    security.configs.recommended,
    {
        // Extension code: runs inside gnome-shell's GJS, not Node.
        files: ['extension.js', 'prefs.js', 'modules/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...gjsGlobals, global: 'readonly' },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
    {
        // Tooling and tests: run on Node.
        files: ['tests/**/*.js', '*.config.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node,
        },
        rules: {
            // The stubs mirror real GObject signatures, so they carry
            // parameters they have no use for. Same convention as the
            // extension code above.
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
];
