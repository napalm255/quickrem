// One stand-in for the Gio.Settings the extension is handed.
//
// The store, the preferences window and the launcher each depend on a
// different slice of the same object, and each test file used to model that
// slice itself. Three partial models of one interface is how a stub drifts
// away from the real thing and a test starts passing for the wrong reason.

import { SignalEmitter } from './gi-gobject.js';

/** Stands in for the Gio.Settings the extension is constructed with. */
export class FakeSettings extends SignalEmitter {
    /**
     * @param {object} values Initial key/value pairs.
     */
    constructor(values = {}) {
        super();
        this.values = new Map(Object.entries(values));
        this.bound = [];
    }

    /**
     * @param {string} key Schema key.
     * @returns {string} Its value, or '' when unset.
     */
    get_string(key) {
        return this.values.get(key) ?? '';
    }

    /**
     * @param {string} key Schema key.
     * @param {string} value New value.
     */
    set_string(key, value) {
        this.values.set(key, value);
        this.emit(`changed::${key}`);
    }

    /**
     * @param {string} key Schema key.
     * @param {object} object Widget to bind to.
     * @param {string} property Property to bind.
     */
    bind(key, object, property) {
        this.bound.push({ key, object, property });
    }
}
