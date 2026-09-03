import { beforeEach, describe, expect, it } from 'vitest';

import {
    handlers,
    launches,
    makeHandler,
    spawned,
    reset as resetGio,
} from './stubs/gi-gio.js';
import { activations, registerApp, reset as resetShell } from './stubs/gi-shell.js';
import { FakeSettings } from './stubs/settings.js';
import { launchProfile, launchRemmina } from '../modules/launch.js';

const MIME = 'application/x-remmina';
const DESKTOP_ID = 'org.remmina.Remmina.desktop';

/**
 * @param {string} launchCommand The launch-command setting.
 * @returns {FakeSettings} Settings holding just that key.
 */
const settingsWith = launchCommand =>
    new FakeSettings({ 'launch-command': launchCommand });

const profile = (path = '/profiles/a.remmina') => ({ name: 'A', path });

beforeEach(() => {
    resetGio();
    resetShell();
});

describe('launchProfile', () => {
    it('opens the profile through the registered handler', () => {
        handlers.set(MIME, makeHandler('org.remmina.Remmina-file.desktop'));

        launchProfile(profile(), new FakeSettings());

        expect(launches).toHaveLength(1);
        expect(launches[0].id).toBe('org.remmina.Remmina-file.desktop');
        expect(launches[0].uris).toEqual(['file:///profiles/a.remmina']);
        expect(spawned).toHaveLength(0);
    });

    it('does not throw or spawn when nothing is registered for the type', () => {
        expect(() => launchProfile(profile(), new FakeSettings())).not.toThrow();

        expect(launches).toHaveLength(0);
        expect(spawned).toHaveLength(0);
    });

    it('prefers an explicit launch-command over the handler', () => {
        handlers.set(MIME, makeHandler('org.remmina.Remmina-file.desktop'));

        launchProfile(profile(), settingsWith('myremmina --connect'));

        expect(launches).toHaveLength(0);
        expect(spawned[0].argv).toEqual([
            'myremmina',
            '--connect',
            '/profiles/a.remmina',
        ]);
    });

    it('never lets a profile path become shell syntax', () => {
        // The one security invariant in the extension: the path is its own argv
        // element, so a filename containing shell metacharacters is an
        // argument, not a second command. A profile file can be created by
        // anything that can write to the profile directory.
        const nasty = '/profiles/a; rm -rf ~/.ssh; echo .remmina';

        launchProfile(profile(nasty), settingsWith('myremmina --connect'));

        expect(spawned[0].argv).toEqual(['myremmina', '--connect', nasty]);
        expect(spawned[0].argv).toHaveLength(3);
    });

    it('swallows an unparseable launch-command rather than throwing', () => {
        // An unbalanced quote makes shell_parse_argv throw. That must not
        // escape into the Shell from a menu activation.
        expect(() =>
            launchProfile(profile(), settingsWith('myremmina "unclosed')),
        ).not.toThrow();

        expect(spawned).toHaveLength(0);
    });

    it('trims a launch-command that is only whitespace and uses the handler', () => {
        handlers.set(MIME, makeHandler('org.remmina.Remmina-file.desktop'));

        launchProfile(profile(), settingsWith('   '));

        expect(launches).toHaveLength(1);
        expect(spawned).toHaveLength(0);
    });
});

describe('launchRemmina', () => {
    it('activates the desktop entry through the app system', () => {
        registerApp(DESKTOP_ID);

        launchRemmina(new FakeSettings());

        expect(activations).toEqual([DESKTOP_ID]);
    });

    it('does not throw when Remmina is not installed', () => {
        expect(() => launchRemmina(new FakeSettings())).not.toThrow();

        expect(activations).toHaveLength(0);
    });

    it('runs launch-command with no path appended', () => {
        registerApp(DESKTOP_ID);

        launchRemmina(settingsWith('myremmina --tray'));

        expect(activations).toHaveLength(0);
        expect(spawned[0].argv).toEqual(['myremmina', '--tray']);
    });
});
