// Stand-in for gi://GLib, wired up by the aliases in vitest.config.js.
//
// Timeouts are queued rather than scheduled: modules/store.js debounces file
// events through GLib.timeout_add, and a test that had to wait 300 ms of real
// time for each assertion would be slow and flaky. runTimeouts() fires them on
// demand instead, which also makes "the debounce coalesced these five events
// into one rescan" directly observable.

/** Environment the stub reports. Tests set these in beforeEach. */
export const env = {
    home: '/home/tester',
    variables: new Map(),
    programs: new Set(),
};

/** Pending timeout callbacks, by source id. */
export const timeouts = new Map();

let nextSourceId = 1;

/** Fire every queued timeout once, in the order they were added. */
export function runTimeouts() {
    const pending = [...timeouts.entries()];
    timeouts.clear();

    for (const [, callback] of pending) callback();
}

/** Clear all recorded state. Call from beforeEach. */
export function reset() {
    env.home = '/home/tester';
    env.variables.clear();
    env.programs.clear();
    timeouts.clear();
    nextSourceId = 1;
}

export default {
    PRIORITY_DEFAULT: 0,
    SOURCE_REMOVE: false,
    SOURCE_CONTINUE: true,

    /** @returns {string} The stubbed home directory. */
    get_home_dir: () => env.home,

    /**
     * @param {string} name Variable name.
     * @returns {string|null} Its value, or null.
     */
    getenv: name => env.variables.get(name) ?? null,

    /**
     * @param {string} name Program to look for.
     * @returns {string|null} A path when the test said it exists.
     */
    find_program_in_path: name => (env.programs.has(name) ? `/usr/bin/${name}` : null),

    /**
     * @param {number} _priority Ignored.
     * @param {number} _interval Ignored; runTimeouts() controls firing.
     * @param {Function} callback The timeout body.
     * @returns {number} A source id.
     */
    timeout_add(_priority, _interval, callback) {
        const id = nextSourceId++;
        timeouts.set(id, callback);
        return id;
    },

    /**
     * @param {string} command A command line.
     * @returns {[boolean, Array<string>]} Success and the argument vector.
     * @throws {Error} On unbalanced quotes, as GLib does.
     */
    shell_parse_argv(command) {
        const argv = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

        if (/["']/.test(command.replace(/"[^"]*"|'[^']*'/g, '')))
            throw new Error('Text ended before matching quote was found');

        return [true, argv.map(arg => arg.replace(/^["']|["']$/g, ''))];
    },

    Source: {
        /**
         * @param {number} id Source to drop.
         */
        remove(id) {
            timeouts.delete(id);
        },
    },
};
