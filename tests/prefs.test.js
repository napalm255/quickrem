import { beforeEach, describe, expect, it } from 'vitest';

import Adw from './stubs/gi-adw.js';
import { fs, reset as resetGio } from './stubs/gi-gio.js';
import { env, reset as resetGLib } from './stubs/gi-glib.js';
import { ExtensionPreferences } from './stubs/shell-prefs.js';
import { SignalEmitter } from './stubs/gi-gobject.js';

const HOME = '/home/tester';
const FLATPAK_DATA = `${HOME}/.var/app/org.remmina.Remmina/data/remmina`;

/** Stands in for the Gio.Settings the preferences window binds to. */
class FakeSettings extends SignalEmitter {
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
     * @returns {string} Its value, or ''.
     */
    get_string(key) {
        return this.values.get(key) ?? '';
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

/**
 * @returns {Promise<object>} A freshly imported prefs.js module.
 */
async function importPrefs() {
    return import('../prefs.js');
}

beforeEach(() => {
    resetGio();
    resetGLib();
    env.home = HOME;
    ExtensionPreferences.gettextAllowed = false;
});

describe('module evaluation', () => {
    it('does not call gettext while the module is being evaluated', async () => {
        // The regression this guards: a translated string built into a
        // module-level table throws "gettext can only be called from
        // extensions", and the preferences window then never opens at all —
        // silently, because nothing else in the extension touches prefs.js.
        await expect(importPrefs()).resolves.toBeDefined();
    });
});

describe('fillPreferencesWindow', () => {
    beforeEach(() => {
        ExtensionPreferences.gettextAllowed = true;
    });

    /**
     * @param {FakeSettings} settings Settings to drive it with.
     * @returns {Promise<object>} The window the preferences filled in.
     */
    async function build(settings) {
        const { default: QuickRemPreferences } = await importPrefs();
        const preferences = new QuickRemPreferences();
        preferences.settings = settings;

        const window = new Adw.PreferencesWindow();
        preferences.fillPreferencesWindow(window);

        // The status row resolves the directory asynchronously so that it and
        // the Shell can share one rule; let that land before asserting.
        await statusRow(window)._sync();

        return window;
    }

    /**
     * @param {object} window A filled preferences window.
     * @returns {object} The status row: window > page > first group > first row.
     */
    function statusRow(window) {
        return window.children[0].children[0].children[0];
    }

    it('binds both overrides to their settings keys', async () => {
        fs.mkdir(FLATPAK_DATA);
        const settings = new FakeSettings();

        await build(settings);

        expect(settings.bound.map(b => b.key).sort()).toEqual([
            'launch-command',
            'profile-dir',
        ]);
    });

    it('reports the detected directory and how it was found', async () => {
        fs.mkdir(FLATPAK_DATA);

        const window = await build(new FakeSettings());
        const status = statusRow(window);

        expect(status.subtitle).toContain(FLATPAK_DATA);
        expect(status.subtitle).toContain('Flatpak');
    });

    it('reports datadir_path from remmina.pref', async () => {
        // The path the store and this window used to probe differently.
        fs.mkdir(FLATPAK_DATA);
        fs.mkdir('/srv/profiles');
        fs.write(
            `${HOME}/.var/app/org.remmina.Remmina/config/remmina/remmina.pref`,
            '[remmina_pref]\nsecret=KEY\ndatadir_path=/srv/profiles\n',
        );

        const window = await build(new FakeSettings());
        const status = statusRow(window);

        expect(status.subtitle).toContain('/srv/profiles');
        expect(status.subtitle).toContain('datadir_path');
        expect(status.subtitle).not.toContain('KEY');
    });

    it('skips an unreadable remmina.pref the way the store does', async () => {
        fs.mkdir(FLATPAK_DATA);
        const nativePref = `${HOME}/.config/remmina/remmina.pref`;
        fs.write(nativePref, '[remmina_pref]\n');
        fs.unreadable.add(nativePref);
        fs.write(
            `${HOME}/.var/app/org.remmina.Remmina/config/remmina/remmina.pref`,
            '[remmina_pref]\ndatadir_path=/srv/profiles\n',
        );
        fs.mkdir('/srv/profiles');

        const window = await build(new FakeSettings());

        expect(statusRow(window).subtitle).toContain('/srv/profiles');
    });

    it('says so when the resolved directory does not exist yet', async () => {
        const settings = new FakeSettings({ 'profile-dir': '/nope/missing' });

        const window = await build(settings);
        const status = statusRow(window);

        expect(status.subtitle).toContain('/nope/missing');
        expect(status.subtitle).toContain('does not exist yet');
    });

    it('tells the user when Remmina is not installed at all', async () => {
        const window = await build(new FakeSettings());
        const status = statusRow(window);

        expect(status.subtitle).toContain('Remmina was not found');
    });

    it('lets go of its settings handler when the row is destroyed', async () => {
        fs.mkdir(FLATPAK_DATA);
        const settings = new FakeSettings();

        const window = await build(settings);
        const status = statusRow(window);
        expect(settings.handlerCount).toBe(1);

        status.destroy();

        expect(settings.handlerCount).toBe(0);
    });
});
