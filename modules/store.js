// The data layer: find the profile directory, read it, and keep reading it.
//
// Everything here is asynchronous. A profile directory lives on whatever the
// user's home is mounted from, and a synchronous read of it would block the
// compositor thread — a stutter in the whole desktop, not just in this menu.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { parseProfile, sortProfiles } from './profiles.js';
import {
    PROFILE_SUFFIX,
    flatpakDataDir,
    joinPath,
    parseDatadirPath,
    prefFileCandidates,
    resolveProfileDir,
} from './paths.js';

/**
 * Remmina rewrites a profile in several steps when it saves, and a file
 * manager copying profiles in emits an event per file. Coalescing for this long
 * turns either into one rescan.
 */
const DEBOUNCE_MS = 300;

/** How many directory entries to ask for per round trip. */
const BATCH_SIZE = 64;

/**
 * Promisify once, and only if nobody else got there first.
 *
 * These prototypes are shared with the rest of the gnome-shell process, so
 * wrapping an already-wrapped method would leave a double wrapper behind for
 * every other extension too. `_promisify` records the original under
 * `_original_<name>`, which is the cheapest reliable way to ask.
 *
 * @param {object} proto Prototype to patch.
 * @param {string} name Name of the `*_async` method.
 */
function promisifyOnce(proto, name) {
    if (proto[`_original_${name}`] === undefined) Gio._promisify(proto, name);
}

promisifyOnce(Gio.File.prototype, 'enumerate_children_async');
promisifyOnce(Gio.File.prototype, 'load_contents_async');
promisifyOnce(Gio.FileEnumerator.prototype, 'next_files_async');

/**
 * @param {Error} error Anything thrown by a Gio call.
 * @param {number} code A Gio.IOErrorEnum member.
 * @returns {boolean} Whether the error is that code.
 */
function isIOError(error, code) {
    return typeof error?.matches === 'function' && error.matches(Gio.IOErrorEnum, code);
}

export const ProfileStore = GObject.registerClass(
    {
        GTypeName: 'QuickRemProfileStore',
        Properties: {
            profiles: GObject.ParamSpec.jsobject(
                'profiles',
                'Profiles',
                'Saved Remmina profiles, sorted by name',
                GObject.ParamFlags.READABLE,
            ),
            directory: GObject.ParamSpec.string(
                'directory',
                'Directory',
                'Directory profiles are read from, empty when none was found',
                GObject.ParamFlags.READABLE,
                '',
            ),
            source: GObject.ParamSpec.string(
                'source',
                'Source',
                'How the directory was chosen: override, datadir, native, flatpak or none',
                GObject.ParamFlags.READABLE,
                'none',
            ),
        },
    },
    class ProfileStore extends GObject.Object {
        /**
         * @param {Gio.Settings} settings The extension's settings.
         */
        constructor(settings) {
            super();

            this._settings = settings;
            this._profiles = [];
            this._directory = '';
            this._source = 'none';
            this._monitor = null;
            this._watchedPath = null;
            this._debounceId = 0;
            this._cancellable = null;
            this._generation = 0;

            // Pointing profile-dir somewhere else has to move the watch as well
            // as the scan, so it goes through the same path as first startup.
            this._settings.connectObject(
                'changed::profile-dir',
                () => this.reload(),
                this,
            );

            this.reload();
        }

        /** @returns {Array<object>} Profiles, sorted by name. */
        get profiles() {
            return this._profiles;
        }

        /** @returns {string} Directory being read, or '' when none was found. */
        get directory() {
            return this._directory;
        }

        /** @returns {string} Why that directory was chosen. */
        get source() {
            return this._source;
        }

        /** Re-detect the profile directory, re-arm the watch and rescan. */
        reload() {
            this._resolve().catch(error =>
                console.warn(
                    `[quickrem] could not resolve the profile directory: ${error}`,
                ),
            );
        }

        /**
         * Tear everything down. Safe to call twice.
         *
         * Every connect above is undone here. A connect that outlives its
         * disconnect is what makes an extension leak a handler per enable, and
         * the Shell only complains about it two enables later.
         */
        destroy() {
            this._settings?.disconnectObject(this);
            this._settings = null;

            this._unwatch();

            if (this._debounceId) {
                GLib.Source.remove(this._debounceId);
                this._debounceId = 0;
            }

            // Bumping the generation strands any scan already in flight, so its
            // continuation returns without touching a destroyed object.
            this._generation++;
            this._cancellable?.cancel();
            this._cancellable = null;
            this._profiles = [];
        }

        /** Probe the system, decide on a directory, then watch and scan it. */
        async _resolve() {
            const home = GLib.get_home_dir();
            const hasNativeRemmina = GLib.find_program_in_path('remmina') !== null;
            const hasFlatpakData = Gio.File.new_for_path(
                flatpakDataDir(home),
            ).query_exists(null);

            const datadirPath = await this._readDatadirPath({ home, hasNativeRemmina });
            if (!this._settings) return;

            const { dir, source } = resolveProfileDir({
                override: this._settings.get_string('profile-dir'),
                datadirPath,
                home,
                xdgDataHome: GLib.getenv('XDG_DATA_HOME'),
                hasNativeRemmina,
                hasFlatpakData,
            });

            if ((dir ?? '') !== this._directory) {
                this._directory = dir ?? '';
                this.notify('directory');
            }

            if (source !== this._source) {
                this._source = source;
                this.notify('source');
            }

            this._watch();
            await this._refresh();
        }

        /**
         * Read `datadir_path` out of whichever remmina.pref exists.
         *
         * @param {object} env Probe results.
         * @param {string} env.home The user's home directory.
         * @param {boolean} env.hasNativeRemmina Whether `remmina` is on PATH.
         * @returns {Promise<string|null>} The configured directory, or null.
         */
        async _readDatadirPath({ home, hasNativeRemmina }) {
            const candidates = prefFileCandidates({
                home,
                xdgConfigHome: GLib.getenv('XDG_CONFIG_HOME'),
                hasNativeRemmina,
            });

            for (const path of candidates) {
                try {
                    const [contents] =
                        await Gio.File.new_for_path(path).load_contents_async(null);

                    // remmina.pref also holds `secret=`, the key stored
                    // passwords are encrypted with. Only datadir_path comes
                    // back out, and the text is not kept.
                    const datadir = parseDatadirPath(
                        new TextDecoder().decode(contents),
                    );
                    if (datadir) return datadir;

                    return null;
                } catch (error) {
                    if (!isIOError(error, Gio.IOErrorEnum.NOT_FOUND))
                        console.warn(`[quickrem] could not read ${path}: ${error}`);
                }
            }

            return null;
        }

        /**
         * Watch the profile directory, or the nearest ancestor that exists.
         *
         * A fresh Remmina install has no profile directory at all, and a custom
         * `datadir_path` may point at one that has not been created yet.
         * Watching the ancestor means the directory appearing is itself an
         * event, so the list fills in without an enable/disable cycle.
         */
        _watch() {
            const target = this._directory
                ? this._nearestExisting(this._directory)
                : null;
            if (target === this._watchedPath) return;

            this._unwatch();
            if (!target) return;

            try {
                this._monitor = Gio.File.new_for_path(target).monitor_directory(
                    Gio.FileMonitorFlags.WATCH_MOVES,
                    null,
                );
            } catch (error) {
                console.warn(`[quickrem] could not watch ${target}: ${error}`);
                return;
            }

            this._watchedPath = target;
            this._monitor.connectObject('changed', () => this._queueRefresh(), this);
        }

        /** Drop the file monitor and its handler together. */
        _unwatch() {
            if (!this._monitor) return;

            this._monitor.disconnectObject(this);
            this._monitor.cancel();
            this._monitor = null;
            this._watchedPath = null;
        }

        /**
         * @param {string} path Directory that may not exist.
         * @returns {string|null} The deepest existing ancestor, or null.
         */
        _nearestExisting(path) {
            let file = Gio.File.new_for_path(path);

            while (file && !file.query_exists(null)) file = file.get_parent();

            return file ? file.get_path() : null;
        }

        /** Coalesce a burst of file events into one rescan. */
        _queueRefresh() {
            if (this._debounceId) GLib.Source.remove(this._debounceId);

            this._debounceId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                DEBOUNCE_MS,
                () => {
                    this._debounceId = 0;

                    // The event may have been the profile directory itself
                    // being created, so move the watch onto it before scanning.
                    this._watch();
                    this._refresh().catch(error =>
                        console.warn(`[quickrem] rescan failed: ${error}`),
                    );

                    return GLib.SOURCE_REMOVE;
                },
            );
        }

        /** Rescan the directory and publish the result. */
        async _refresh() {
            this._cancellable?.cancel();

            const cancellable = new Gio.Cancellable();
            this._cancellable = cancellable;
            const generation = ++this._generation;

            let profiles = [];
            if (this._directory) {
                try {
                    profiles = await this._scan(this._directory, cancellable);
                } catch (error) {
                    if (isIOError(error, Gio.IOErrorEnum.CANCELLED)) return;
                    console.warn(
                        `[quickrem] could not read ${this._directory}: ${error}`,
                    );
                }
            }

            // A scan overtaken by a newer one must not land after it, or a
            // burst of saves leaves the menu showing an older directory state.
            if (generation !== this._generation) return;

            this._cancellable = null;
            this._profiles = sortProfiles(profiles);
            this.notify('profiles');
        }

        /**
         * @param {string} dir Directory to read.
         * @param {Gio.Cancellable} cancellable Cancelled when superseded.
         * @returns {Promise<Array<object>>} Parsed profiles, unsorted.
         */
        async _scan(dir, cancellable) {
            let enumerator;
            try {
                enumerator = await Gio.File.new_for_path(dir).enumerate_children_async(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                );
            } catch (error) {
                // A directory that is not there yet is the normal state on a
                // fresh install, not a failure worth logging.
                if (isIOError(error, Gio.IOErrorEnum.NOT_FOUND)) return [];
                throw error;
            }

            const paths = [];
            for (;;) {
                const infos = await enumerator.next_files_async(
                    BATCH_SIZE,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                );
                if (infos.length === 0) break;

                for (const info of infos) {
                    const name = info.get_name();
                    if (!name.endsWith(PROFILE_SUFFIX)) continue;
                    if (info.get_file_type() === Gio.FileType.DIRECTORY) continue;

                    paths.push(joinPath(dir, name));
                }
            }

            const profiles = [];
            for (const path of paths) {
                try {
                    const [contents] =
                        await Gio.File.new_for_path(path).load_contents_async(
                            cancellable,
                        );

                    profiles.push(
                        parseProfile(new TextDecoder().decode(contents), path),
                    );
                } catch (error) {
                    if (isIOError(error, Gio.IOErrorEnum.CANCELLED)) throw error;

                    // One unreadable profile must not cost the user the rest of
                    // the list.
                    console.warn(`[quickrem] skipping ${path}: ${error}`);
                }
            }

            return profiles;
        }
    },
);
