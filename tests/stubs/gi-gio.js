// Stand-in for gi://Gio, wired up by the aliases in vitest.config.js.
//
// Backed by an in-memory filesystem so modules/store.js runs exactly as it
// ships: the same enumerate/read/parse path, the same cancellation, the same
// monitor. Nothing here touches a real disk, so the tests stay fast and cannot
// depend on what Remmina happens to have saved on the machine running them.

import { SignalEmitter } from './gi-gobject.js';

/** The error domain Gio raises file errors in. */
const IO_ERROR_QUARK = 'g-io-error-quark';

export const IOErrorEnum = { NOT_FOUND: 1, CANCELLED: 19, PERMISSION_DENIED: 2 };

/** A GLib.Error as GJS presents it: an Error that can be asked what it is. */
export class GioError extends Error {
    /**
     * @param {number} code A member of IOErrorEnum.
     * @param {string} message Human-readable detail.
     */
    constructor(code, message) {
        super(message);
        this.domain = IO_ERROR_QUARK;
        this.code = code;
    }

    /**
     * @param {string} domain Error domain to test against.
     * @param {number} code Error code to test against.
     * @returns {boolean} Whether this error is that one.
     */
    matches(domain, code) {
        return this.domain === domain && this.code === code;
    }
}

/**
 * @param {string} path Any absolute path.
 * @returns {string|null} Its parent, or null at the root.
 */
function parentOf(path) {
    if (path === '/') return null;

    const cut = path.lastIndexOf('/');
    return cut <= 0 ? '/' : path.slice(0, cut);
}

/** The in-memory filesystem. Tests drive this directly. */
export const fs = {
    /** @type {Map<string, {type: string, text: string}>} */
    entries: new Map(),

    /** Empty the filesystem, leaving only the root. */
    reset() {
        this.entries.clear();
        this.entries.set('/', { type: 'dir', text: '' });
    },

    /**
     * @param {string} path Directory to create, with its ancestors.
     */
    mkdir(path) {
        for (let at = path; at; at = parentOf(at))
            if (!this.entries.has(at)) this.entries.set(at, { type: 'dir', text: '' });
    },

    /**
     * @param {string} path File to create, with its ancestors.
     * @param {string} text Its contents.
     */
    write(path, text) {
        this.mkdir(parentOf(path));
        this.entries.set(path, { type: 'file', text });
    },

    /**
     * @param {string} path Entry to delete.
     */
    remove(path) {
        this.entries.delete(path);
    },

    /**
     * @param {string} path Directory to list.
     * @returns {Array<string>} Its immediate children.
     */
    children(path) {
        return [...this.entries.keys()].filter(entry => parentOf(entry) === path);
    },
};

/** Every monitor handed out, so tests can fire events on them. */
export const monitors = [];

/** Clear the filesystem and the monitor list. Call from beforeEach. */
export function reset() {
    fs.reset();
    monitors.length = 0;
}

/**
 * @param {object|null} cancellable Cancellable to check.
 * @throws {GioError} CANCELLED when it has been cancelled.
 */
function throwIfCancelled(cancellable) {
    if (cancellable?.is_cancelled())
        throw new GioError(IOErrorEnum.CANCELLED, 'Operation was cancelled');
}

class Cancellable {
    constructor() {
        this._cancelled = false;
    }

    /** Cancel any operation holding this. */
    cancel() {
        this._cancelled = true;
    }

    /** @returns {boolean} Whether cancel() has been called. */
    is_cancelled() {
        return this._cancelled;
    }
}

class FileInfo {
    /**
     * @param {string} name Basename.
     * @param {string} type 'dir' or 'file'.
     */
    constructor(name, type) {
        this._name = name;
        this._type = type;
    }

    /** @returns {string} The basename. */
    get_name() {
        return this._name;
    }

    /** @returns {number} A FileType member. */
    get_file_type() {
        return this._type === 'dir' ? FileType.DIRECTORY : FileType.REGULAR;
    }
}

class FileEnumerator {
    /**
     * @param {Array<string>} paths Children to hand out.
     */
    constructor(paths) {
        this._paths = [...paths];
    }

    /**
     * @param {number} count How many to return at most.
     * @param {number} _priority Ignored.
     * @param {object|null} cancellable Cancelled when superseded.
     * @returns {Promise<Array<FileInfo>>} The next batch, empty when done.
     */
    async next_files_async(count, _priority, cancellable) {
        throwIfCancelled(cancellable);

        return this._paths.splice(0, count).map(path => {
            const name = path.slice(path.lastIndexOf('/') + 1);
            return new FileInfo(name, fs.entries.get(path)?.type ?? 'file');
        });
    }
}

class FileMonitor extends SignalEmitter {
    /**
     * @param {string} path Directory being watched.
     */
    constructor(path) {
        super();
        this.path = path;
        this.cancelled = false;
    }

    /** Stop watching. */
    cancel() {
        this.cancelled = true;
    }

    /** Fire a `changed` event, as the real monitor would on a write. */
    fire() {
        this.emit('changed');
    }
}

class GioFile {
    /**
     * @param {string} path Absolute path.
     */
    constructor(path) {
        this.path = path;
    }

    /** @returns {string} The path. */
    get_path() {
        return this.path;
    }

    /** @returns {string} A file:// URI. */
    get_uri() {
        return `file://${this.path}`;
    }

    /** @returns {GioFile|null} The parent, or null at the root. */
    get_parent() {
        const parent = parentOf(this.path);
        return parent ? new GioFile(parent) : null;
    }

    /** @returns {boolean} Whether anything is at this path. */
    query_exists() {
        return fs.entries.has(this.path);
    }

    /**
     * @param {number} _flags Ignored.
     * @returns {FileMonitor} A monitor, recorded in `monitors`.
     */
    monitor_directory(_flags) {
        const monitor = new FileMonitor(this.path);
        monitors.push(monitor);
        return monitor;
    }

    /**
     * @param {string} _attributes Ignored.
     * @param {number} _flags Ignored.
     * @param {number} _priority Ignored.
     * @param {object|null} cancellable Cancelled when superseded.
     * @returns {Promise<FileEnumerator>} An enumerator over the children.
     */
    async enumerate_children_async(_attributes, _flags, _priority, cancellable) {
        throwIfCancelled(cancellable);

        const entry = fs.entries.get(this.path);
        if (!entry || entry.type !== 'dir')
            throw new GioError(IOErrorEnum.NOT_FOUND, `${this.path} does not exist`);

        return new FileEnumerator(fs.children(this.path));
    }

    /**
     * Matches the real promisified signature, which resolves to
     * [contents, etag] — the boolean the synchronous call returns is dropped.
     *
     * @param {object|null} cancellable Cancelled when superseded.
     * @returns {Promise<[Uint8Array, string]>} Contents and etag.
     */
    async load_contents_async(cancellable) {
        throwIfCancelled(cancellable);

        const entry = fs.entries.get(this.path);
        if (!entry || entry.type !== 'file')
            throw new GioError(IOErrorEnum.NOT_FOUND, `${this.path} does not exist`);

        return [new TextEncoder().encode(entry.text), 'etag'];
    }
}

// modules/store.js promisifies these, and skips any that already has an
// `_original_` recorded. The stub's versions already return promises, so the
// markers keep _promisify away from them.
GioFile.prototype._original_enumerate_children_async = () => {};
GioFile.prototype._original_load_contents_async = () => {};
FileEnumerator.prototype._original_next_files_async = () => {};

const FileType = { REGULAR: 1, DIRECTORY: 2 };

export default {
    IOErrorEnum,
    FileType,
    FileQueryInfoFlags: { NONE: 0 },
    FileMonitorFlags: { NONE: 0, WATCH_MOVES: 8 },
    SubprocessFlags: { NONE: 0 },
    SettingsBindFlags: { DEFAULT: 0, GET: 1, SET: 2, NO_SENSITIVITY: 4 },

    File: Object.assign(GioFile, {
        /**
         * @param {string} path Absolute path.
         * @returns {GioFile} A handle on it.
         */
        new_for_path: path => new GioFile(path),
    }),

    FileEnumerator,
    Cancellable,

    /** Never reached: everything the store promisifies is already a promise. */
    _promisify() {
        throw new Error('gi-gio stub: _promisify should not be called');
    },
};
