// Stand-in for gi://GObject, wired up by the aliases in vitest.config.js.
//
// Only what modules/store.js needs: a base class that can emit, the two
// signal-tracker methods gnome-shell adds to GObject.Object, and enough of
// ParamSpec for registerClass to accept the property block.

/**
 * The signal behaviour store.js relies on. `connectObject` and
 * `disconnectObject` are gnome-shell's additions, not GObject's, but they are
 * on every GObject inside the Shell and are the whole point of the teardown
 * this stub exists to test.
 */
export class SignalEmitter {
    constructor() {
        this._handlers = [];
        this._nextId = 1;
    }

    /**
     * @param {string} signal Signal name.
     * @param {Function} callback Handler.
     * @returns {number} A handler id.
     */
    connect(signal, callback) {
        const id = this._nextId++;
        this._handlers.push({ id, signal, callback, owner: null });
        return id;
    }

    /**
     * @param {number} id Handler id returned by connect().
     */
    disconnect(id) {
        this._handlers = this._handlers.filter(handler => handler.id !== id);
    }

    /**
     * @param {...any} args Pairs of signal and handler, then the owner object.
     */
    connectObject(...args) {
        const owner = args.pop();

        for (let i = 0; i < args.length; i += 2) {
            const [signal, callback] = args.slice(i, i + 2);
            this._handlers.push({ id: this._nextId++, signal, callback, owner });
        }
    }

    /**
     * @param {object} owner Object whose handlers should go.
     */
    disconnectObject(owner) {
        this._handlers = this._handlers.filter(handler => handler.owner !== owner);
    }

    /**
     * @param {string} signal Signal to emit.
     * @param {...any} params Extra arguments for handlers.
     */
    emit(signal, ...params) {
        for (const handler of [...this._handlers])
            if (handler.signal === signal) handler.callback(this, ...params);
    }

    /**
     * @param {string} property Property that changed.
     */
    notify(property) {
        this.emit(`notify::${property}`);
    }

    /** @returns {number} Handlers still attached, for leak assertions. */
    get handlerCount() {
        return this._handlers.length;
    }
}

const paramSpec = () => ({});

export default {
    /**
     * @param {object|Function} meta Property block, or the class itself.
     * @param {Function} [cls] The class, when meta was a property block.
     * @returns {Function} The class, unchanged.
     */
    registerClass(meta, cls) {
        return typeof meta === 'function' ? meta : cls;
    },

    Object: SignalEmitter,

    ParamFlags: { READABLE: 1, WRITABLE: 2, READWRITE: 3 },

    ParamSpec: {
        jsobject: paramSpec,
        string: paramSpec,
        boolean: paramSpec,
        int: paramSpec,
    },
};
