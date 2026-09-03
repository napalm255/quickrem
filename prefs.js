// Preferences. Runs in its own process, with no access to gnome-shell's
// resource:// modules — so nothing here may import from modules/panel.js or
// modules/store.js.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// modules/paths.js imports nothing, so it is safe to pull into this process.
// Sharing it is what stops the directory shown here from drifting away from
// the one the Shell actually reads.
import {
    flatpakDataDir,
    prefFileCandidates,
    readDatadirPath,
    resolveProfileDir,
} from './modules/paths.js';

/**
 * How each outcome of resolveProfileDir reads to a person.
 *
 * A function rather than a module-level table because `_()` may only be called
 * once the extension is resolved and its gettext domain is bound. Building the
 * table at module load throws "gettext can only be called from extensions" and
 * the preferences window never opens at all.
 *
 * @param {string} source A source from resolveProfileDir.
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

/**
 * Work out which directory the Shell would read, right now.
 *
 * The decision is resolveProfileDir's and the rule for which remmina.pref wins
 * is readDatadirPath's; only the reading differs. Synchronous I/O is fine here
 * — this is an ordinary application process, not the compositor thread — and
 * routing it through the same shared rule is what stops this window reporting a
 * different directory than the panel actually reads.
 *
 * @param {Gio.Settings} settings Extension settings.
 * @returns {Promise<{dir: string|null, source: string}>} The directory and why.
 */
async function detectProfileDir(settings) {
    const home = GLib.get_home_dir();
    const hasNativeRemmina = GLib.find_program_in_path('remmina') !== null;
    const hasFlatpakData = Gio.File.new_for_path(flatpakDataDir(home)).query_exists(
        null,
    );

    const candidates = prefFileCandidates({
        home,
        xdgConfigHome: GLib.getenv('XDG_CONFIG_HOME'),
        hasNativeRemmina,
    });

    const datadirPath = await readDatadirPath(candidates, async path => {
        // Synchronous load_contents returns (ok, contents, etag); the
        // promisified async one drops the boolean. They genuinely differ.
        const [, contents] = Gio.File.new_for_path(path).load_contents(null);

        return new TextDecoder().decode(contents);
    });

    return resolveProfileDir({
        override: settings.get_string('profile-dir'),
        datadirPath,
        home,
        xdgDataHome: GLib.getenv('XDG_DATA_HOME'),
        hasNativeRemmina,
        hasFlatpakData,
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
                this._sync(),
            );
            this.connect('destroy', () => {
                if (this._changedId) {
                    this._settings.disconnect(this._changedId);
                    this._changedId = 0;
                }
            });

            this._sync();
        }

        /**
         * Recompute the subtitle from the current settings.
         *
         * @returns {Promise<void>} Resolves once the subtitle is set. Returned
         *   so a test can await it; nothing in the UI needs to.
         */
        async _sync() {
            try {
                const { dir, source } = await detectProfileDir(this._settings);

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
        status.add(new StatusRow(settings));
        page.add(status);

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
