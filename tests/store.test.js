import { beforeEach, describe, expect, it, vi } from 'vitest';

import Gio, { fs, monitors, reset as resetGio } from './stubs/gi-gio.js';
import { env, runTimeouts, timeouts, reset as resetGLib } from './stubs/gi-glib.js';
import { SignalEmitter } from './stubs/gi-gobject.js';
import { ProfileStore } from '../modules/store.js';

const HOME = '/home/tester';
const FLATPAK_DATA = `${HOME}/.var/app/org.remmina.Remmina/data/remmina`;
const FLATPAK_CONFIG = `${HOME}/.var/app/org.remmina.Remmina/config/remmina`;

/** Stands in for the Gio.Settings the extension hands the store. */
class FakeSettings extends SignalEmitter {
    /**
     * @param {object} values Initial key/value pairs.
     */
    constructor(values = {}) {
        super();
        this.values = new Map(Object.entries(values));
    }

    /**
     * @param {string} key Schema key.
     * @returns {string} Its value, or ''.
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
}

/** Let every pending promise in the store finish. */
async function settle() {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * @param {string} name File name, without the directory.
 * @param {object} fields Profile fields.
 * @param {string} [dir] Directory to write into.
 */
function writeProfile(name, fields, dir = FLATPAK_DATA) {
    const body = Object.entries(fields)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    fs.write(`${dir}/${name}`, `[remmina]\n${body}\n`);
}

/**
 * @param {FakeSettings} settings Settings to drive it with.
 * @returns {Promise<ProfileStore>} A store that has finished its first scan.
 */
async function newStore(settings = new FakeSettings()) {
    const store = new ProfileStore(settings);
    await settle();
    return store;
}

beforeEach(() => {
    resetGio();
    resetGLib();
    env.home = HOME;
});

describe('finding the directory', () => {
    it('detects the flatpak data directory', async () => {
        fs.mkdir(FLATPAK_DATA);

        const store = await newStore();

        expect(store.directory).toBe(FLATPAK_DATA);
        expect(store.source).toBe('flatpak');
    });

    it('prefers a native install when remmina is on PATH', async () => {
        fs.mkdir(FLATPAK_DATA);
        env.programs.add('remmina');

        const store = await newStore();

        expect(store.directory).toBe(`${HOME}/.local/share/remmina`);
        expect(store.source).toBe('native');
    });

    it('honours datadir_path from remmina.pref', async () => {
        fs.mkdir(FLATPAK_DATA);
        fs.write(
            `${FLATPAK_CONFIG}/remmina.pref`,
            '[remmina_pref]\nsecret=KEY\ndatadir_path=/srv/profiles\n',
        );

        const store = await newStore();

        expect(store.directory).toBe('/srv/profiles');
        expect(store.source).toBe('datadir');
    });

    it('reports nothing found when Remmina is not installed', async () => {
        const store = await newStore();

        expect(store.directory).toBe('');
        expect(store.source).toBe('none');
        expect(store.profiles).toEqual([]);
    });
});

describe('scanning', () => {
    beforeEach(() => fs.mkdir(FLATPAK_DATA));

    it('reads every profile and sorts them by name', async () => {
        writeProfile('c.remmina', { name: 'zeta', protocol: 'SSH' });
        writeProfile('a.remmina', { name: 'Alpha', protocol: 'RDP' });
        writeProfile('b.remmina', { name: 'mid', protocol: 'VNC' });

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Alpha', 'mid', 'zeta']);
        expect(store.profiles.map(p => p.protocol)).toEqual(['RDP', 'VNC', 'SSH']);
    });

    it('ignores files that are not profiles, and directories that look like one', async () => {
        writeProfile('real.remmina', { name: 'Real' });
        fs.write(`${FLATPAK_DATA}/notes.txt`, 'ignore me');
        fs.write(`${FLATPAK_DATA}/remmina.pref`, '[remmina_pref]\n');
        fs.mkdir(`${FLATPAK_DATA}/decoy.remmina`);

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Real']);
    });

    it('never carries an encrypted field out of the file', async () => {
        writeProfile('secret.remmina', {
            name: 'Has secrets',
            password: 'Zm9vYmFy',
            ssh_passphrase: 'cGhyYXNl',
        });

        const store = await newStore();

        expect(JSON.stringify(store.profiles)).not.toMatch(/Zm9vYmFy|cGhyYXNl/);
    });

    it('reports an empty directory as empty, not as missing', async () => {
        const store = await newStore();

        expect(store.profiles).toEqual([]);
        expect(store.directory).toBe(FLATPAK_DATA);
    });

    it('notifies once the scan lands', async () => {
        writeProfile('a.remmina', { name: 'Alpha' });

        const store = new ProfileStore(new FakeSettings());
        const seen = [];
        store.connect('notify::profiles', () => seen.push(store.profiles.length));

        await settle();

        expect(seen.at(-1)).toBe(1);
    });
});

describe('watching', () => {
    it('watches the profile directory when it exists', async () => {
        fs.mkdir(FLATPAK_DATA);

        await newStore();

        expect(monitors.at(-1).path).toBe(FLATPAK_DATA);
    });

    it('watches the nearest existing ancestor when it does not, then moves on', async () => {
        // A fresh Remmina install has the app directory but no profile
        // directory. Watching the ancestor is what makes it appearing an event.
        const ancestor = `${HOME}/.var/app/org.remmina.Remmina`;
        fs.mkdir(ancestor);
        fs.mkdir(FLATPAK_DATA);
        const settings = new FakeSettings({ 'profile-dir': `${ancestor}/later` });

        const store = await newStore(settings);
        expect(monitors.at(-1).path).toBe(ancestor);

        fs.mkdir(`${ancestor}/later`);
        fs.write(`${ancestor}/later/new.remmina`, '[remmina]\nname=New\n');

        monitors.at(-1).fire();
        runTimeouts();
        await settle();

        expect(monitors.at(-1).path).toBe(`${ancestor}/later`);
        expect(store.profiles.map(p => p.name)).toEqual(['New']);
    });

    it('picks up an added profile without an enable cycle', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();
        expect(store.profiles).toEqual([]);

        writeProfile('new.remmina', { name: 'Fresh', protocol: 'SSH' });
        monitors.at(-1).fire();
        runTimeouts();
        await settle();

        expect(store.profiles.map(p => p.name)).toEqual(['Fresh']);
    });

    it('picks up a removed profile', async () => {
        fs.mkdir(FLATPAK_DATA);
        writeProfile('gone.remmina', { name: 'Gone' });
        const store = await newStore();
        expect(store.profiles).toHaveLength(1);

        fs.remove(`${FLATPAK_DATA}/gone.remmina`);
        monitors.at(-1).fire();
        runTimeouts();
        await settle();

        expect(store.profiles).toEqual([]);
    });

    it('coalesces a burst of events into a single rescan', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();

        const scan = vi.spyOn(Gio.File.prototype, 'enumerate_children_async');
        const monitor = monitors.at(-1);

        // Remmina rewrites a profile in several steps when it saves.
        for (let i = 0; i < 5; i++) monitor.fire();

        expect(timeouts.size).toBe(1);

        runTimeouts();
        await settle();

        expect(scan).toHaveBeenCalledTimes(1);
        scan.mockRestore();
        expect(store.profiles).toEqual([]);
    });

    it('lets the newest scan win when two overlap', async () => {
        fs.mkdir(FLATPAK_DATA);
        writeProfile('a.remmina', { name: 'First' });
        const store = await newStore();

        // Two rescans in flight at once. The older one is cancelled by the
        // newer, so what lands is the newer directory state.
        fs.remove(`${FLATPAK_DATA}/a.remmina`);
        const stale = store._refresh();
        writeProfile('b.remmina', { name: 'Second' });
        const fresh = store._refresh();

        await Promise.all([stale, fresh]);
        await settle();

        expect(store.profiles.map(p => p.name)).toEqual(['Second']);
    });

    it('drops a scan that was superseded after its last read', async () => {
        fs.mkdir(FLATPAK_DATA);
        writeProfile('a.remmina', { name: 'Published' });
        const store = await newStore();
        expect(store.profiles.map(p => p.name)).toEqual(['Published']);

        // Cancelling covers a scan that is still reading. It cannot cover the
        // window between the last read resolving and the result being
        // published, which is what the generation counter is for: bump it the
        // way a newer refresh would and the older result must be thrown away.
        fs.remove(`${FLATPAK_DATA}/a.remmina`);
        writeProfile('b.remmina', { name: 'Superseded' });

        const inFlight = store._refresh();
        store._generation++;
        await inFlight;
        await settle();

        expect(store.profiles.map(p => p.name)).toEqual(['Published']);
    });
});

describe('settings changes', () => {
    it('re-resolves and moves the watch when profile-dir changes', async () => {
        fs.mkdir(FLATPAK_DATA);
        fs.mkdir('/srv/elsewhere');
        fs.write('/srv/elsewhere/x.remmina', '[remmina]\nname=Elsewhere\n');

        const settings = new FakeSettings();
        const store = await newStore(settings);
        expect(store.directory).toBe(FLATPAK_DATA);

        settings.set_string('profile-dir', '/srv/elsewhere');
        await settle();

        expect(store.directory).toBe('/srv/elsewhere');
        expect(store.source).toBe('override');
        expect(monitors.at(-1).path).toBe('/srv/elsewhere');
        expect(store.profiles.map(p => p.name)).toEqual(['Elsewhere']);
    });
});

describe('destroy', () => {
    it('lets go of every handler, source and monitor', async () => {
        fs.mkdir(FLATPAK_DATA);
        const settings = new FakeSettings();
        const store = await newStore(settings);

        const monitor = monitors.at(-1);
        monitor.fire();
        expect(timeouts.size).toBe(1);

        store.destroy();

        expect(settings.handlerCount).toBe(0);
        expect(monitor.handlerCount).toBe(0);
        expect(monitor.cancelled).toBe(true);
        expect(timeouts.size).toBe(0);
        expect(store.profiles).toEqual([]);
    });

    it('is inert afterwards, even if a late event arrives', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();
        const monitor = monitors.at(-1);

        store.destroy();

        writeProfile('late.remmina', { name: 'Too late' });
        monitor.fire();
        runTimeouts();
        await settle();

        expect(store.profiles).toEqual([]);
    });

    it('can be called twice', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();

        store.destroy();
        expect(() => store.destroy()).not.toThrow();
    });
});
