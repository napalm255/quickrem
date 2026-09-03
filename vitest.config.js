import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const stub = name =>
    fileURLToPath(new URL(`./tests/stubs/${name}.js`, import.meta.url));

export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            // Everything that holds a decision. modules/profiles.js and
            // modules/paths.js import nothing and run as they ship;
            // modules/store.js runs against the Gio stub below, which is what
            // makes the debounce, the generation counter and the watch
            // re-attach reachable from a unit test at all. prefs.js is here
            // because it decides something too — which directory to report —
            // and because a module-level gettext call there stops the
            // preferences window opening at all, silently. tests/prefs.test.js
            // exists to catch exactly that.
            include: ['modules/**/*.js', 'prefs.js'],
            // panel.js and extension.js are widget construction and lifecycle
            // wiring: St and QuickSettings objects assembled in a fixed order.
            // A unit test can only assert those against stubs of the toolkit,
            // which tests the stubs. They are covered instead by
            // scripts/headless-check.sh, which enables, disables and re-enables
            // the real extension in a real gnome-shell and fails on a leaked
            // handler — a stricter check than a stubbed one would be.
            // extension.js is left out of `include` above and panel.js is named
            // here; between them that is exactly sonar.coverage.exclusions in
            // sonar-project.properties, so the two agree.
            // tests/stubs/* get pulled in through the aliases below, so they
            // are named here as well; a stub's own coverage means nothing.
            exclude: ['modules/panel.js', 'tests/**'],
        },
    },

    // gnome-shell resolves these at runtime; Node cannot. The stubs live in
    // tests/, so they are never shipped and never counted as covered code.
    resolve: {
        alias: [
            { find: 'gi://Gio', replacement: stub('gi-gio') },
            { find: 'gi://GLib', replacement: stub('gi-glib') },
            { find: 'gi://GObject', replacement: stub('gi-gobject') },
            { find: 'gi://Adw', replacement: stub('gi-adw') },
            { find: 'gi://Shell', replacement: stub('gi-shell') },
            {
                find: 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js',
                replacement: stub('shell-prefs'),
            },
        ],
    },
});
