// Stand-in for gi://Shell, wired up by the aliases in vitest.config.js.
//
// Only Shell.AppSystem, which modules/launch.js uses to find Remmina's own
// desktop entry.

/** Desktop ids the app system should know about. Tests populate this. */
export const apps = new Map();

/** Every Shell.App.activate() call, in order. */
export const activations = [];

/** Clear all recorded state. Call from beforeEach. */
export function reset() {
    apps.clear();
    activations.length = 0;
}

/**
 * @param {string} id Desktop id to register.
 */
export function registerApp(id) {
    apps.set(id, {
        get_id: () => id,
        activate: () => activations.push(id),
    });
}

export default {
    AppSystem: {
        get_default: () => ({
            /**
             * @param {string} id Desktop id.
             * @returns {object|null} The app, or null when not installed.
             */
            lookup_app: id => apps.get(id) ?? null,
        }),
    },
};
