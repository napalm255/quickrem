// Preferences. Runs in its own process, with no access to gnome-shell's
// resource:// modules — so nothing here may import from modules/panel.js or
// modules/store.js.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// modules/detect.js imports only gi:// and modules/paths.js, so it is safe to
// pull into this process. Sharing the whole probe — not just the rules under it
// — is what stops the directory shown here from drifting away from the one the
// Shell actually reads.
import { detectProfileDir } from './modules/detect.js';

/**
 * How each outcome of the detection reads to a person.
 *
 * A function rather than a module-level table because `_()` may only be called
 * once the extension is resolved and its gettext domain is bound. Building the
 * table at module load throws "gettext can only be called from extensions" and
 * the preferences window never opens at all.
 *
 * @param {string} source A source from detectProfileDir.
 * @returns {string} How to describe it.
 */
function sourceLabel(source) {
    switch (source) {
        case 'override':
            return _('set below');
        case 'datadir':
            return _('from datadir_path in remmina.pref');
        case 'native':
            return _('detected from the native Remmina install');
        case 'flatpak':
            return _('detected from the Flatpak install');
        default:
            return source;
    }
}

/** Stateless for these calls, so one is reused rather than one per read. */
const DECODER = new TextDecoder();

/**
 * Work out which directory the Shell would read, right now.
 *
 * The probe and the precedence rules are detect.js's; only the reading differs.
 * Synchronous I/O is fine here — this is an ordinary application process, not
 * the compositor thread — and routing it through the same shared probe is what
 * stops this window reporting a different directory than the panel reads.
 *
 * @param {Gio.Settings} settings Extension settings.
 * @returns {Promise<{dir: string|null, source: string}>} The directory and why.
 */
function detectFor(settings) {
    return detectProfileDir({
        override: settings.get_string('profile-dir'),
        readText: async path => {
            // Synchronous load_contents returns (ok, contents, etag); the
            // promisified async one drops the boolean. They genuinely differ.
            const [, contents] = Gio.File.new_for_path(path).load_contents(null);

            return DECODER.decode(contents);
        },
    });
}

/**
 * A row that says what the extension resolved to, so a mistyped override or a
 * missing Remmina is visible here rather than only as an empty menu.
 */
const StatusRow = GObject.registerClass(
    class QuickRemStatusRow extends Adw.ActionRow {
        /**
         * @param {Gio.Settings} settings Extension settings.
         */
        constructor(settings) {
            super({ title: _('Profile directory') });

            this._settings = settings;
            this.add_css_class('property');

            this._changedId = settings.connect('changed::profile-dir', () =>
                this.refresh(),
            );
            this.connect('destroy', () => this._settings.disconnect(this._changedId));

            // Deliberately not started here: a constructor cannot await, and a
            // promise left running from one is both unobservable and a smell.
            // fillPreferencesWindow calls refresh() once the row is built.
        }

        /**
         * Recompute the subtitle from the current settings.
         *
         * @returns {Promise<void>} Resolves once the subtitle is set. Returned
         *   so a test can await it; nothing in the UI needs to.
         */
        async refresh() {
            try {
                const { dir, source } = await detectFor(this._settings);

                if (!dir) {
                    this.subtitle = _(
                        'Remmina was not found. Install it, or set a directory below.',
                    );
                    return;
                }

                const how = sourceLabel(source);
                const exists = Gio.File.new_for_path(dir).query_exists(null);

                this.subtitle = exists
                    ? `${dir}\n${how}`
                    : `${dir}\n${how} — ${_('does not exist yet')}`;
            } catch (error) {
                console.warn(`[quickrem] could not resolve the directory: ${error}`);
            }
        }
    },
);

export default class QuickRemPreferences extends ExtensionPreferences {
    /**
     * @param {Adw.PreferencesWindow} window Window to fill.
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const status = new Adw.PreferencesGroup({
            title: _('Remmina'),
            description: _(
                'QuickRem detects where Remmina keeps its profiles. Override either ' +
                    'setting only if detection gets it wrong.',
            ),
        });
        const statusRow = new StatusRow(settings);
        status.add(statusRow);
        page.add(status);

        // Started here rather than from the row's constructor, so the promise
        // has somewhere to belong.
        statusRow.refresh();

        const overrides = new Adw.PreferencesGroup({ title: _('Overrides') });

        const dir = new Adw.EntryRow({ title: _('Profile directory') });
        settings.bind('profile-dir', dir, 'text', Gio.SettingsBindFlags.DEFAULT);
        overrides.add(dir);

        const command = new Adw.EntryRow({ title: _('Launch command') });
        settings.bind('launch-command', command, 'text', Gio.SettingsBindFlags.DEFAULT);
        overrides.add(command);

        page.add(overrides);
        window.add(page);
    }
}
