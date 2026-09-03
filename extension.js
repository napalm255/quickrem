// QuickRem — Remmina connections in the Quick Settings panel.
//
// The extension owns two things: a store that reads the profile directory and
// watches it, and an indicator that renders what the store found. All the
// interesting code is in modules/; this file only pairs construction with
// teardown.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { RemminaIndicator } from './modules/panel.js';
import { ProfileStore } from './modules/store.js';

export default class QuickRemExtension extends Extension {
    enable() {
        this._store = new ProfileStore(this.getSettings());
        this._indicator = new RemminaIndicator(this, this._store);

        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        // scripts/headless-check.sh greps for this line; keep the prefix stable.
        console.debug(`[quickrem] enabled (v${this.metadata['version-name'] ?? '?'})`);
    }

    disable() {
        // The indicator holds handlers on the store, so it goes first. The
        // other order leaves the store notifying a destroyed actor.
        this._indicator?.destroy();
        this._indicator = null;

        this._store?.destroy();
        this._store = null;
    }
}
