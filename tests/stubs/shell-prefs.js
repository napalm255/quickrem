// Stand-in for resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js.

export class ExtensionPreferences {
    constructor() {
        this.settings = null;
    }

    /** @returns {object} Whatever the test assigned to `settings`. */
    getSettings() {
        return this.settings;
    }
}

/**
 * The real gettext resolves the calling extension from the stack and throws
 * when there is not one — which is exactly what happens if `_()` is called
 * while the module is still being evaluated, before the extension is resolved.
 * Throwing here is what makes tests/prefs.test.js able to catch that.
 *
 * @param {string} text String to translate.
 * @returns {string} The same string.
 */
export function gettext(text) {
    if (!ExtensionPreferences.gettextAllowed)
        throw new Error('gettext can only be called from extensions');

    return text;
}
