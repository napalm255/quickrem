import { describe, expect, it } from 'vitest';

import {
    parseProfile,
    protocolIcon,
    sameProfiles,
    sortProfiles,
} from '../modules/profiles.js';

const PATH = '/data/remmina/lab_ssh_box.remmina';

describe('parseProfile', () => {
    it('reads the fields the menu needs', () => {
        const profile = parseProfile(
            [
                '[remmina]',
                'name=Prod DB',
                'group=Work',
                'protocol=SSH',
                'server=db.example.com',
                'username=napalm',
            ].join('\n'),
            PATH,
        );

        expect(profile).toEqual({
            name: 'Prod DB',
            group: 'Work',
            protocol: 'SSH',
            server: 'db.example.com',
            username: 'napalm',
            path: PATH,
        });
    });

    it('drops every encrypted field while parsing', () => {
        const profile = parseProfile(
            [
                '[remmina]',
                'name=Prod DB',
                'password=Zm9vYmFyPT0=',
                'ssh_passphrase=c2VjcmV0',
                'ssh_tunnel_password=dG9wc2VjcmV0',
                'gateway_password=aGlkZGVu',
            ].join('\n'),
            PATH,
        );

        // Not "the menu ignores them" — they must not be in the object at all,
        // so a later code path cannot find one to leak.
        const serialised = JSON.stringify(profile);
        for (const secret of ['Zm9vYmFyPT0=', 'c2VjcmV0', 'dG9wc2VjcmV0', 'aGlkZGVu'])
            expect(serialised).not.toContain(secret);

        expect(Object.keys(profile).sort()).toEqual([
            'group',
            'name',
            'path',
            'protocol',
            'server',
            'username',
        ]);
    });

    it('falls back to the filename when there is no usable name', () => {
        expect(parseProfile('[remmina]\nprotocol=RDP\n', PATH).name).toBe(
            'lab_ssh_box',
        );
        expect(parseProfile('[remmina]\nname=\n', PATH).name).toBe('lab_ssh_box');
        expect(parseProfile('[remmina]\nname=   \n', PATH).name).toBe('lab_ssh_box');
    });

    it('keeps everything after the first = in a value', () => {
        // Base64 padding and RDP option strings both contain =, and splitting
        // on all of them truncates the value silently.
        const profile = parseProfile(
            '[remmina]\nname=A\nserver=host?opt=1&other=2\n',
            PATH,
        );

        expect(profile.server).toBe('host?opt=1&other=2');
    });

    it('normalises the protocol and trims whitespace', () => {
        const profile = parseProfile(
            '[remmina]\n  name  =  Spaced  \nprotocol=rdp\n',
            PATH,
        );

        expect(profile.name).toBe('Spaced');
        expect(profile.protocol).toBe('RDP');
    });

    it('unescapes GKeyFile values', () => {
        const profile = parseProfile('[remmina]\nname=a\\nb\\tc\\\\d\n', PATH);

        expect(profile.name).toBe('a\nb\tc\\d');
    });

    it('ignores comments, blank lines and other sections', () => {
        const profile = parseProfile(
            [
                '# a comment',
                '',
                '[remmina_pref]',
                'name=Wrong Section',
                '[remmina]',
                '; another comment',
                'name=Right Section',
            ].join('\n'),
            PATH,
        );

        expect(profile.name).toBe('Right Section');
    });

    it('survives a file with no [remmina] section at all', () => {
        const profile = parseProfile('nonsense\n', PATH);

        expect(profile.name).toBe('lab_ssh_box');
        expect(profile.protocol).toBe('');
    });
});

describe('sortProfiles', () => {
    it('orders by name and leaves the input alone', () => {
        const input = [{ name: 'zeta' }, { name: 'Alpha' }, { name: 'mid' }];
        const sorted = sortProfiles(input);

        expect(sorted.map(p => p.name)).toEqual(['Alpha', 'mid', 'zeta']);
        expect(input.map(p => p.name)).toEqual(['zeta', 'Alpha', 'mid']);
    });
});

describe('protocolIcon', () => {
    it('maps the protocols Remmina ships plugins for', () => {
        expect(protocolIcon('SSH')).toBe('utilities-terminal-symbolic');
        expect(protocolIcon('rdp')).toBe('preferences-desktop-remote-desktop-symbolic');
        expect(protocolIcon(' vnc ')).toBe(
            'preferences-desktop-remote-desktop-symbolic',
        );
        expect(protocolIcon('WWW')).toBe('web-browser-symbolic');
    });

    it('falls back for anything unknown or missing', () => {
        for (const value of ['', 'NX', undefined, null, 42])
            expect(protocolIcon(value)).toBe('network-server-symbolic');
    });
});

describe('sameProfiles', () => {
    const one = {
        path: '/p/a.remmina',
        name: 'A',
        group: 'g',
        protocol: 'SSH',
        server: 's',
        username: 'u',
    };

    it('matches identical lists', () => {
        expect(sameProfiles([one], [{ ...one }])).toBe(true);
        expect(sameProfiles([], [])).toBe(true);
    });

    it('notices a different length, order or field', () => {
        expect(sameProfiles([one], [])).toBe(false);
        expect(
            sameProfiles(
                [one, { ...one, path: '/p/b.remmina' }],
                [{ ...one, path: '/p/b.remmina' }, one],
            ),
        ).toBe(false);

        for (const field of ['path', 'name', 'group', 'protocol', 'server', 'username'])
            expect(sameProfiles([one], [{ ...one, [field]: 'changed' }])).toBe(false);
    });
});
