// The UI layer: the Quick Settings tile, its menu, and launching.
//
// The only file in QuickRem that touches St, Main or QuickSettings. It holds no
// profile state of its own — the store owns that, and this rebuilds from
// `notify::profiles`.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {
    gettext as _,
    ngettext,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import { launchProfile, launchRemmina } from './launch.js';
import { protocolIcon } from './profiles.js';

/**
 * How much of the work area the profile list may take before it starts to
 * scroll. The rest has to hold the menu header, the separator and the two
 * footer items, and the quick settings panel is anchored under the top bar, so
 * the list cannot have the screen to itself.
 */
const LIST_MAX_HEIGHT_FRACTION = 0.5;

/** Floor for that, so a short screen still shows a usable number of rows. */
const LIST_MIN_HEIGHT = 200;

/**
 * The profile list, in a scroll view.
 *
 * QuickToggleMenu has no scrolling of its own — measured on a 1080p screen, 30
 * profiles want 1296px of a 1048px work area, and the surplus is simply clipped.
 * GNOME's own Wi-Fi menu answers this by showing only the first eight networks
 * and sending you to Settings for the rest, which suits a list you skim but not
 * one you pick from: the whole point here is that any saved connection is one
 * click away.
 *
 * So the list scrolls instead. PopupMenuSection is subclassed rather than
 * wrapped because PopupMenuBase.addMenuItem() adds `section.actor` to the menu
 * and does its bookkeeping against the section object; swapping the actor for a
 * scroll view around the same box keeps every bit of that — key navigation,
 * open-state propagation and activation — while changing what the menu holds.
 */
class ProfileSection extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        this.actor = new St.ScrollView({
            style_class: 'quickrem-profile-list',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            clip_to_allocation: true,
            child: this.box,
        });
        this.actor._delegate = this;
    }

    /**
     * Re-cap the list against the current screen and show the scrollbar only
     * when there is something to scroll.
     *
     * Called on every rebuild and on every menu open, which covers a monitor
     * change or a text-scaling change without watching for either.
     */
    updateHeight() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const max = Math.max(
            LIST_MIN_HEIGHT,
            Math.round(workArea.height * LIST_MAX_HEIGHT_FRACTION),
        );

        // A max-height on the scroll view is what makes it scroll at all; St
        // otherwise gives it whatever its contents ask for.
        this.actor.style = `max-height: ${max}px;`;

        const [, natural] = this.box.get_preferred_height(-1);
        const scrolls = natural > max;

        // AUTOMATIC always reserves width for a scrollbar, which looks wrong
        // when there is nothing to scroll, so it is turned on only when needed.
        this.actor.vscrollbar_policy = scrolls
            ? St.PolicyType.AUTOMATIC
            : St.PolicyType.NEVER;

        if (scrolls) this.actor.add_style_pseudo_class('scrolled');
        else this.actor.remove_style_pseudo_class('scrolled');
    }
}

const RemminaToggle = GObject.registerClass(
    {
        GTypeName: 'QuickRemToggle',
    },
    class RemminaToggle extends QuickSettings.QuickMenuToggle {
        /**
         * @param {object} extension The Extension instance.
         * @param {object} store A ProfileStore.
         * @param {Gio.Icon} gicon Icon for the tile and the menu header.
         */
        constructor(extension, store, gicon) {
            super({
                title: _('Remmina'),
                gicon,
                // There is no boolean state to toggle — the tile is a way into
                // a list, not a switch — so the checked state is never used.
                toggleMode: false,
                menuEnabled: true,
            });

            this._extension = extension;
            this._settings = extension.getSettings();
            this._store = store;
            this._gicon = gicon;

            // With toggleMode off, the Shell leaves a body click to us: only
            // the arrow opens the menu by default. A tile that does nothing
            // when clicked in the middle reads as broken, so both open it.
            this.connectObject('clicked', () => this.menu.open(), this);

            this.menu.setHeader(gicon, _('Remmina'));

            this._section = new ProfileSection();
            this.menu.addMenuItem(this._section);

            // Re-measured on open as well as on rebuild, so moving the Shell to
            // a different monitor or changing text scaling is picked up without
            // watching for either.
            this.menu.connectObject(
                'open-state-changed',
                (_menu, open) => {
                    if (open) this._section.updateHeight();
                },
                this,
            );
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const open = new PopupMenu.PopupMenuItem(_('Open Remmina…'));
            open.connectObject(
                'activate',
                () => {
                    this._closePanel();
                    launchRemmina(this._settings);
                },
                this,
            );
            this.menu.addMenuItem(open);

            const preferences = new PopupMenu.PopupMenuItem(_('Settings'));
            preferences.connectObject(
                'activate',
                () => {
                    this._closePanel();
                    this._extension.openPreferences();
                },
                this,
            );
            this.menu.addMenuItem(preferences);

            // The directory matters as well as the contents: it is what tells
            // an empty list apart from a missing Remmina.
            store.connectObject(
                'notify::profiles',
                () => this._rebuild(),
                'notify::directory',
                () => this._rebuild(),
                this,
            );

            this._rebuild();
        }

        /** Close the whole system menu, not just this tile's submenu. */
        _closePanel() {
            Main.panel.statusArea.quickSettings.menu.close();
        }

        /** Rebuild the profile list from the store. */
        _rebuild() {
            this._section.removeAll();

            const profiles = this._store.profiles;
            const subtitle =
                profiles.length > 0
                    ? ngettext('%d profile', '%d profiles', profiles.length).format(
                          profiles.length,
                      )
                    : '';

            this.subtitle = subtitle;
            this.menu.setHeader(this._gicon, _('Remmina'), subtitle);

            if (profiles.length === 0) {
                this._section.addMenuItem(this._emptyItem());
                this._section.updateHeight();
                return;
            }

            for (const profile of profiles) {
                const item = new PopupMenu.PopupImageMenuItem(
                    profile.name,
                    protocolIcon(profile.protocol),
                );

                item.connectObject(
                    'activate',
                    () => {
                        this._closePanel();
                        launchProfile(profile, this._settings);
                    },
                    this,
                );

                this._section.addMenuItem(item);
            }

            this._section.updateHeight();
        }

        /**
         * @returns {PopupMenu.PopupMenuItem} An inert item saying why the list
         *   is empty: no Remmina at all, or a Remmina with nothing saved yet.
         */
        _emptyItem() {
            const label =
                this._store.directory === ''
                    ? _('Remmina not found')
                    : _('No profiles saved');

            const item = new PopupMenu.PopupMenuItem(label, {
                reactive: false,
                can_focus: false,
            });
            item.setSensitive(false);

            return item;
        }

        destroy() {
            this.menu.disconnectObject(this);
            this._store?.disconnectObject(this);
            this._store = null;
            this._extension = null;
            this._settings = null;
            this._section = null;

            super.destroy();
        }
    },
);

export const RemminaIndicator = GObject.registerClass(
    {
        GTypeName: 'QuickRemIndicator',
    },
    class RemminaIndicator extends QuickSettings.SystemIndicator {
        /**
         * @param {object} extension The Extension instance.
         * @param {object} store A ProfileStore.
         */
        constructor(extension, store) {
            super();

            // No _addIndicator(): Remmina is not a status, and a permanent top
            // bar icon that never changes is noise. The tile is the whole UI.
            const gicon = Gio.icon_new_for_string(
                `${extension.path}/icons/quickrem-symbolic.svg`,
            );

            this.quickSettingsItems.push(new RemminaToggle(extension, store, gicon));
        }

        destroy() {
            this.quickSettingsItems.forEach(item => item.destroy());
            this.quickSettingsItems.length = 0;

            super.destroy();
        }
    },
);
