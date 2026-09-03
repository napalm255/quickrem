// Probing the system for where Remmina keeps its profiles.
//
// The rules live in modules/paths.js, which imports nothing so that it stays
// loadable by Vitest and by the preferences process. What could not live there
// is the probe itself — it needs Gio and GLib — and that probe used to be
// copied into both the Shell and the preferences process. Sharing the rules but
// not the wiring left six argument names and the `profile-dir` key spelled out
// twice, which is the drift both files' headers say they exist to prevent.
//
// Only the reading differs between the two processes: the Shell must not block
// the compositor, the preferences process may read synchronously. So the reader
// is the one parameter, exactly as readDatadirPath already assumed.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    flatpakDataDir,
    prefFileCandidates,
    readDatadirPath,
    resolveProfileDir,
} from './paths.js';

/**
 * Work out which directory holds the profiles, and why.
 *
 * @param {object} options Options.
 * @param {string} options.override The `profile-dir` setting; blank means auto.
 * @param {Function} options.readText Async, returns a file's text or throws.
 * @returns {Promise<{dir: string|null, source: string}>} The directory and the
 *   reason it was chosen: override, datadir, native, flatpak or none.
 */
export async function detectProfileDir({ override, readText }) {
    const home = GLib.get_home_dir();
    const hasNativeRemmina = GLib.find_program_in_path('remmina') !== null;
    const hasFlatpakData = Gio.File.new_for_path(flatpakDataDir(home)).query_exists(
        null,
    );

    // remmina.pref also holds `secret=`, the key stored passwords are encrypted
    // with; only datadir_path comes back out of the parser, and the text is not
    // kept.
    const datadirPath = await readDatadirPath(
        prefFileCandidates({
            home,
            xdgConfigHome: GLib.getenv('XDG_CONFIG_HOME'),
            hasNativeRemmina,
        }),
        readText,
    );

    return resolveProfileDir({
        override,
        datadirPath,
        home,
        xdgDataHome: GLib.getenv('XDG_DATA_HOME'),
        hasNativeRemmina,
        hasFlatpakData,
    });
}
