// Where Remmina keeps its profiles, and how we decide.
//
// Imports nothing, for the same reasons as modules/profiles.js. Every probe
// this needs — is there a native remmina on PATH, does the flatpak data
// directory exist, what does remmina.pref say — is passed in by the caller, so
// each branch of the precedence below is a unit test with no filesystem.

/** Flatpak application id, and the ids the launcher needs. */
export const APP_ID = 'org.remmina.Remmina';

/** The desktop entry for Remmina's main window. */
export const DESKTOP_ID = `${APP_ID}.desktop`;

/**
 * Remmina registers a handler for this, and on this machine the default is
 * org.remmina.Remmina-file.desktop, whose Exec is the `-c` connect action with
 * `--file-forwarding`. Launching through the MIME type rather than through
 * `flatpak run` therefore works for a native install too, and lets the portal
 * translate the path into the sandbox.
 */
export const PROFILE_MIME_TYPE = 'application/x-remmina';

/** Suffix Remmina gives every profile. */
export const PROFILE_SUFFIX = '.remmina';

/**
 * @param {string} value A path segment.
 * @returns {string} It, without trailing separators.
 */
function trimTrailingSlashes(value) {
    let end = value.length;
    while (end > 0 && value.charAt(end - 1) === '/') end--;

    return value.slice(0, end);
}

/**
 * @param {string} value A path segment.
 * @returns {string} It, without leading or trailing separators.
 */
function trimSlashes(value) {
    let start = 0;
    while (start < value.length && value.charAt(start) === '/') start++;

    return trimTrailingSlashes(value.slice(start));
}

/**
 * Join path segments with a single separator, ignoring empty ones.
 *
 * Trimmed by scanning rather than with /\/+$/ and /^\/+|\/+$/: those backtrack
 * super-linearly on a run of separators, and one of the inputs is the
 * user-supplied profile-dir setting.
 *
 * @param {...string} parts Segments to join.
 * @returns {string} The joined path.
 */
export function joinPath(...parts) {
    return parts
        .filter(part => part !== '' && part != null)
        .map((part, i) => (i === 0 ? trimTrailingSlashes(part) : trimSlashes(part)))
        .join('/');
}

/**
 * @param {string} home The user's home directory.
 * @returns {string} XDG_DATA_HOME as seen from inside the Remmina flatpak.
 */
export function flatpakDataDir(home) {
    return joinPath(home, '.var/app', APP_ID, 'data/remmina');
}

/**
 * @param {string} home The user's home directory.
 * @returns {string} XDG_CONFIG_HOME as seen from inside the Remmina flatpak.
 */
export function flatpakConfigDir(home) {
    return joinPath(home, '.var/app', APP_ID, 'config/remmina');
}

/**
 * @param {object} env Environment.
 * @param {string} [env.xdgDataHome] XDG_DATA_HOME, if set.
 * @param {string} env.home The user's home directory.
 * @returns {string} Where a native Remmina keeps profiles.
 */
export function nativeDataDir({ xdgDataHome, home }) {
    return joinPath(xdgDataHome || joinPath(home, '.local/share'), 'remmina');
}

/**
 * @param {object} env Environment.
 * @param {string} [env.xdgConfigHome] XDG_CONFIG_HOME, if set.
 * @param {string} env.home The user's home directory.
 * @returns {string} Where a native Remmina keeps remmina.pref.
 */
export function nativeConfigDir({ xdgConfigHome, home }) {
    return joinPath(xdgConfigHome || joinPath(home, '.config'), 'remmina');
}

/**
 * remmina.pref files to look for, most likely first.
 *
 * Both are listed regardless of which install was detected: a user who has just
 * moved from the RPM to the flatpak still has the old file, and reading the
 * wrong one only ever costs a `datadir_path` we would not have had otherwise.
 *
 * @param {object} env Environment.
 * @param {string} env.home The user's home directory.
 * @param {string} [env.xdgConfigHome] XDG_CONFIG_HOME, if set.
 * @param {boolean} env.hasNativeRemmina Whether `remmina` is on PATH.
 * @returns {Array<string>} Absolute paths to try, in order.
 */
export function prefFileCandidates({ home, xdgConfigHome, hasNativeRemmina }) {
    const native = joinPath(nativeConfigDir({ xdgConfigHome, home }), 'remmina.pref');
    const flatpak = joinPath(flatpakConfigDir(home), 'remmina.pref');

    return hasNativeRemmina ? [native, flatpak] : [flatpak, native];
}

/**
 * Pull `datadir_path` out of a remmina.pref.
 *
 * The same file holds `secret=`, the key Remmina encrypts stored passwords
 * with. Only datadir_path is ever returned, and the caller never keeps the
 * rest of the text.
 *
 * @param {string} text Contents of remmina.pref.
 * @returns {string|null} The configured profile directory, or null when unset.
 */
export function parseDatadirPath(text) {
    if (typeof text !== 'string') return null;

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('datadir_path')) continue;

        const eq = line.indexOf('=');
        if (eq < 1) continue;

        const value = line.slice(eq + 1).trim();
        if (value !== '') return value;
    }

    return null;
}

/**
 * Read `datadir_path` from the first remmina.pref that can be read.
 *
 * Both callers need this and they read files differently — the Shell must not
 * block the compositor, the preferences process can read synchronously — so the
 * reader is passed in and only the rule lives here. That rule is: a file we
 * cannot read is skipped, and the first one we *can* read decides, even when it
 * has no `datadir_path`. A native install's preferences are authoritative for a
 * native install; a datadir configured in the Flatpak's copy says nothing about
 * where the native binary looks.
 *
 * @param {Array<string>} candidates Paths to try, in order.
 * @param {Function} readText Async, returns the file's text or throws.
 * @returns {Promise<string|null>} The configured directory, or null.
 */
export async function readDatadirPath(candidates, readText) {
    for (const path of candidates) {
        let text;

        try {
            text = await readText(path);
        } catch {
            continue;
        }

        return parseDatadirPath(text);
    }

    return null;
}

/**
 * Decide which directory to read profiles from.
 *
 * @param {object} probe What the Shell layer found out.
 * @param {string} [probe.override] The `profile-dir` setting; blank means auto.
 * @param {string} [probe.datadirPath] `datadir_path` from remmina.pref.
 * @param {string} probe.home The user's home directory.
 * @param {string} [probe.xdgDataHome] XDG_DATA_HOME, if set.
 * @param {boolean} [probe.hasNativeRemmina] Whether `remmina` is on PATH.
 * @param {boolean} [probe.hasFlatpakData] Whether the flatpak data dir exists.
 * @returns {{dir: string|null, source: string}} The directory and why it was
 *   chosen: one of override, datadir, native, flatpak or none.
 */
export function resolveProfileDir({
    override,
    datadirPath,
    home,
    xdgDataHome,
    hasNativeRemmina = false,
    hasFlatpakData = false,
}) {
    const trimmedOverride = (override ?? '').trim();
    if (trimmedOverride !== '') return { dir: trimmedOverride, source: 'override' };

    const trimmedDatadir = (datadirPath ?? '').trim();
    if (trimmedDatadir !== '') return { dir: trimmedDatadir, source: 'datadir' };

    // A native install is preferred when both are present: it is the one whose
    // profiles `remmina` on the command line would open.
    if (hasNativeRemmina)
        return { dir: nativeDataDir({ xdgDataHome, home }), source: 'native' };

    if (hasFlatpakData) return { dir: flatpakDataDir(home), source: 'flatpak' };

    return { dir: null, source: 'none' };
}
