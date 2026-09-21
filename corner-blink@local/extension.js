// SPDX-FileCopyrightText: Copyright (c) 2026 Wataru Ashihara <wataash0607@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import St from 'gi://St';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class CornerBlinkExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._dots = [];
        this._indicatorDots = [];
        this._blinkTimeout = null;
        this._stopTimeout = null;
        // Idle by default. Flash once whenever flash-trigger changes value.
        this._triggerId = this._settings.connect('changed::flash-trigger', () => this._flash());
        // Steady bottom-right indicator while indicator-color is non-empty.
        this._indicatorId = this._settings.connect('changed::indicator-color', () => this._updateIndicator());
        this._sizeId = this._settings.connect('changed::size', () => this._updateIndicator());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._updateIndicator());
        this._updateIndicator();
    }

    _updateIndicator() {
        for (const dot of this._indicatorDots)
            dot.destroy();
        this._indicatorDots = [];

        const color = this._settings.get_string('indicator-color');
        if (!color)
            return;
        const size = this._settings.get_int('size');
        for (const m of Main.layoutManager.monitors) {
            const dot = new St.Widget({
                style: `background-color: ${color};`,
                width: size,
                height: size,
                x: m.x + m.width - size,
                y: m.y + m.height - size,
                reactive: false,
            });
            Main.layoutManager.uiGroup.add_child(dot);
            // keep above the lock screen (screenShield)
            Main.layoutManager.uiGroup.set_child_above_sibling(dot, null);
            this._indicatorDots.push(dot);
        }
    }

    _flash() {
        // restart cleanly if a flash is already running
        this._teardown();

        const size = this._settings.get_int('size');
        const interval = this._settings.get_int('flash-interval');
        const duration = this._settings.get_int('flash-duration');
        const color = this._settings.get_string('flash-color');
        if (duration <= 0)
            return;

        // place dots at every corner of every monitor
        for (const m of Main.layoutManager.monitors) {
            const corners = [
                [m.x, m.y],
                [m.x + m.width - size, m.y],
                [m.x, m.y + m.height - size],
                [m.x + m.width - size, m.y + m.height - size],
            ];
            for (const [x, y] of corners) {
                const dot = new St.Widget({
                    style: `background-color: ${color};`,
                    width: size,
                    height: size,
                    x,
                    y,
                    reactive: false,
                });
                Main.layoutManager.uiGroup.add_child(dot);
                this._dots.push(dot);
            }
        }

        this._visible = true;
        this._blinkTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._visible = !this._visible;
            for (const dot of this._dots) {
                dot.visible = this._visible;
                // keep above the lock screen (screenShield)
                if (this._visible)
                    Main.layoutManager.uiGroup.set_child_above_sibling(dot, null);
            }
            return GLib.SOURCE_CONTINUE;
        });

        // stop the flash after `duration` ms
        this._stopTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            this._stopTimeout = null;
            this._teardown();
            return GLib.SOURCE_REMOVE;
        });
    }

    _teardown() {
        if (this._blinkTimeout) {
            GLib.source_remove(this._blinkTimeout);
            this._blinkTimeout = null;
        }
        if (this._stopTimeout) {
            GLib.source_remove(this._stopTimeout);
            this._stopTimeout = null;
        }
        for (const dot of this._dots ?? [])
            dot.destroy();
        this._dots = [];
    }

    disable() {
        this._teardown();
        for (const dot of this._indicatorDots ?? [])
            dot.destroy();
        this._indicatorDots = [];
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = null;
        }
        if (this._indicatorId) {
            this._settings.disconnect(this._indicatorId);
            this._indicatorId = null;
        }
        if (this._sizeId) {
            this._settings.disconnect(this._sizeId);
            this._sizeId = null;
        }
        if (this._triggerId) {
            this._settings.disconnect(this._triggerId);
            this._triggerId = null;
        }
        this._settings = null;
    }
}
