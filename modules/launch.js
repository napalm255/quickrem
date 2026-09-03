// Starting Remmina.
//
// Split out of modules/panel.js because none of it is widget code: it is the
// decision of what to run and with which arguments, and it carries this
// extension's one security invariant — a profile path is passed as its own
// argument vector element and is never interpolated into a command string.
// panel.js imports St and QuickSettings, which a unit test cannot supply
// meaningfully; this file imports neither, so the invariant is testable.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import { DESKTOP_ID, PROFILE_MIME_TYPE } from './paths.js';

/**
 * Launch context tied to the current workspace and no particular monitor, so
 * Remmina's window opens where the click came from and gets a startup
 * notification instead of appearing unannounced.
 *
 * @returns {object|null} A launch context, or null outside a live Shell.
 */
function launchContext() {
    return global.create_app_launch_context?.(0, -1) ?? null;
}

/**
 * Run the user's `launch-command`, optionally against one profile.
 *
 * This is the escape hatch for an install the MIME handler does not cover. The
 * profile path is appended as a separate argv element rather than interpolated
 * into the string, so a path is never re-parsed as shell syntax — a profile
 * named with a semicolon is an argument, not a second command.
 *
 * @param {string} command The configured command line.
 * @param {string|null} path Profile to open, or null for the main window.
 */
function spawnOverride(command, path) {
    const [ok, argv] = GLib.shell_parse_argv(command);
    if (!ok) throw new Error(`could not parse launch-command: ${command}`);

    if (path) argv.push(path);

    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
}

/**
 * Open one saved profile.
 *
 * The default path goes through the handler registered for
 * `application/x-remmina`, which on a Flatpak install is Remmina's own `-c`
 * connect entry with `--file-forwarding`. That means the portal maps the path
 * into the sandbox, an already-running Remmina picks the request up, and the
 * identical code works for a distribution package.
 *
 * @param {object} profile A profile from the store.
 * @param {Gio.Settings} settings The extension's settings.
 */
export function launchProfile(profile, settings) {
    try {
        const override = settings.get_string('launch-command').trim();
        if (override !== '') {
            spawnOverride(override, profile.path);
            return;
        }

        const handler = Gio.AppInfo.get_default_for_type(PROFILE_MIME_TYPE, false);
        if (!handler) {
            console.warn(
                `[quickrem] nothing is registered to open ${PROFILE_MIME_TYPE}`,
            );
            return;
        }

        const uri = Gio.File.new_for_path(profile.path).get_uri();
        handler.launch_uris([uri], launchContext());
    } catch (error) {
        // A failed launch is the user's problem to see in the log, never the
        // Shell's problem to crash on.
        console.warn(`[quickrem] could not open ${profile.path}: ${error}`);
    }
}

/**
 * Open Remmina's own window, with no profile.
 *
 * @param {Gio.Settings} settings The extension's settings.
 */
export function launchRemmina(settings) {
    try {
        const override = settings.get_string('launch-command').trim();
        if (override !== '') {
            spawnOverride(override, null);
            return;
        }

        // Shell.AppSystem rather than Gio.DesktopAppInfo, which GJS has
        // deprecated in favour of a platform-specific library. Shell.App also
        // brings its own launch context, so the window lands on the current
        // workspace and gets a startup notification without one being built.
        const app = Shell.AppSystem.get_default().lookup_app(DESKTOP_ID);
        if (!app) {
            console.warn(`[quickrem] ${DESKTOP_ID} is not installed`);
            return;
        }

        app.activate();
    } catch (error) {
        console.warn(`[quickrem] could not start Remmina: ${error}`);
    }
}
