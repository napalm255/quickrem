import { describe, expect, it } from 'vitest';

import {
    APP_ID,
    flatpakConfigDir,
    flatpakDataDir,
    joinPath,
    nativeDataDir,
    parseDatadirPath,
    prefFileCandidates,
    resolveProfileDir,
} from '../modules/paths.js';

const HOME = '/home/tester';

describe('joinPath', () => {
    it('joins with exactly one separator', () => {
        expect(joinPath('/a', 'b', 'c')).toBe('/a/b/c');
        expect(joinPath('/a/', '/b/', '/c')).toBe('/a/b/c');
        expect(joinPath('/a', '', 'b')).toBe('/a/b');
    });
});

describe('directory helpers', () => {
    it('puts the flatpak dirs under .var/app', () => {
        expect(flatpakDataDir(HOME)).toBe(`${HOME}/.var/app/${APP_ID}/data/remmina`);
        expect(flatpakConfigDir(HOME)).toBe(
            `${HOME}/.var/app/${APP_ID}/config/remmina`,
        );
    });

    it('honours XDG_DATA_HOME and falls back to .local/share', () => {
        expect(nativeDataDir({ home: HOME })).toBe(`${HOME}/.local/share/remmina`);
        expect(nativeDataDir({ home: HOME, xdgDataHome: '/xdg/data' })).toBe(
            '/xdg/data/remmina',
        );
    });
});

describe('prefFileCandidates', () => {
    it('looks at the install that is actually present first', () => {
        const native = prefFileCandidates({ home: HOME, hasNativeRemmina: true });
        expect(native[0]).toBe(`${HOME}/.config/remmina/remmina.pref`);

        const flatpak = prefFileCandidates({ home: HOME, hasNativeRemmina: false });
        expect(flatpak[0]).toBe(
            `${HOME}/.var/app/${APP_ID}/config/remmina/remmina.pref`,
        );
    });

    it('still lists the other one, for a part-finished migration', () => {
        expect(prefFileCandidates({ home: HOME, hasNativeRemmina: true })).toHaveLength(
            2,
        );
    });
});

describe('parseDatadirPath', () => {
    it('finds datadir_path when it is set', () => {
        expect(
            parseDatadirPath(
                '[remmina_pref]\nsecret=aaaa\ndatadir_path=/srv/remmina\n',
            ),
        ).toBe('/srv/remmina');
    });

    it('returns null when it is absent, blank or the file is not text', () => {
        expect(parseDatadirPath('[remmina_pref]\nsecret=aaaa\n')).toBeNull();
        expect(parseDatadirPath('[remmina_pref]\ndatadir_path=\n')).toBeNull();
        expect(parseDatadirPath('[remmina_pref]\ndatadir_path=   \n')).toBeNull();
        expect(parseDatadirPath(undefined)).toBeNull();
    });

    it('does not return the encryption key next to it', () => {
        const text = '[remmina_pref]\nsecret=TOPSECRETKEY\ndatadir_path=/srv\n';

        expect(parseDatadirPath(text)).toBe('/srv');
        expect(parseDatadirPath(text)).not.toContain('TOPSECRET');
    });
});

describe('resolveProfileDir', () => {
    it('puts the settings override above everything', () => {
        expect(
            resolveProfileDir({
                override: '  /srv/profiles  ',
                datadirPath: '/from/pref',
                home: HOME,
                hasNativeRemmina: true,
                hasFlatpakData: true,
            }),
        ).toEqual({ dir: '/srv/profiles', source: 'override' });
    });

    it('uses datadir_path when there is no override', () => {
        expect(
            resolveProfileDir({
                datadirPath: '/from/pref',
                home: HOME,
                hasFlatpakData: true,
            }),
        ).toEqual({ dir: '/from/pref', source: 'datadir' });
    });

    it('prefers a native install over the flatpak', () => {
        // A native remmina is the one `remmina -c` on the command line would
        // use, so its profiles are the ones the user means.
        expect(
            resolveProfileDir({
                home: HOME,
                hasNativeRemmina: true,
                hasFlatpakData: true,
            }),
        ).toEqual({ dir: `${HOME}/.local/share/remmina`, source: 'native' });
    });

    it('falls back to the flatpak data directory', () => {
        expect(resolveProfileDir({ home: HOME, hasFlatpakData: true })).toEqual({
            dir: `${HOME}/.var/app/${APP_ID}/data/remmina`,
            source: 'flatpak',
        });
    });

    it('reports nothing found when Remmina is not installed', () => {
        expect(resolveProfileDir({ home: HOME })).toEqual({
            dir: null,
            source: 'none',
        });
    });

    it('treats a whitespace-only override as unset', () => {
        expect(
            resolveProfileDir({ override: '   ', home: HOME, hasFlatpakData: true }),
        ).toEqual({
            dir: `${HOME}/.var/app/${APP_ID}/data/remmina`,
            source: 'flatpak',
        });
    });
});
