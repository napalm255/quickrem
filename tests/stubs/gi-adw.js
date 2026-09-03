// Stand-in for gi://Adw, wired up by the aliases in vitest.config.js.
//
// Enough of the widget API for prefs.js to be imported and run. It records what
// was built rather than rendering anything, so a test can assert on the rows
// that came out.

class Widget {
    /**
     * @param {object} props Construct properties.
     */
    constructor(props = {}) {
        Object.assign(this, props);
        this.cssClasses = [];
        this.signals = [];
    }

    /**
     * @param {string} name Class to add.
     */
    add_css_class(name) {
        this.cssClasses.push(name);
    }

    /**
     * @param {string} signal Signal name.
     * @param {Function} callback Handler.
     * @returns {number} A handler id.
     */
    connect(signal, callback) {
        this.signals.push({ signal, callback });
        return this.signals.length;
    }

    /** Fire the widget's `destroy` handlers, as GTK would. */
    destroy() {
        for (const { signal, callback } of this.signals)
            if (signal === 'destroy') callback(this);
    }
}

class Container extends Widget {
    /**
     * @param {object} props Construct properties.
     */
    constructor(props = {}) {
        super(props);
        this.children = [];
    }

    /**
     * @param {object} child Child to add.
     */
    add(child) {
        this.children.push(child);
    }
}

export default {
    ActionRow: class ActionRow extends Widget {},
    EntryRow: class EntryRow extends Widget {},
    PreferencesGroup: class PreferencesGroup extends Container {},
    PreferencesPage: class PreferencesPage extends Container {},
    PreferencesWindow: class PreferencesWindow extends Container {},
};
