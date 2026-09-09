// SPDX-FileCopyrightText: Copyright (c) 2026 Wataru Ashihara <wataash0607@gmail.com>
// SPDX-License-Identifier: Apache-2.0
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ThumbnailsBox} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import {selectTitle} from './workspaceTitleModel.js';

export class WorkspaceTitles {
    constructor(session) {
        this._session = session;
        this._labels = new Map();
        this._boxes = new Map();
        this._records = [];
        this._measureCache = new Map();
        this._injections = new InjectionManager();
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._settingsSignal = this._settings.connect('changed::workspace-names', () => this.refresh());
        const directory = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'agent-workspaces', 'titles']);
        GLib.mkdir_with_parents(directory, 0o700);
        this._directory = Gio.File.new_for_path(directory);
        this._monitor = this._directory.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => {
            if (!this._pending) {
                this._pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                    this._pending = 0;
                    this.refresh();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        this._overviewSignal = Main.overview.connect('showing', () => this.refresh());
        this._livenessTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            if (Main.overview.visible)
                this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this._hiddenSignal = Main.overview.connect('hidden', () => this._hideTooltip());
        this._tooltip = new St.Label({style_class: 'workspace-title-tooltip', visible: false, reactive: false});
        this._tooltip.clutter_text.line_wrap = true;
        this._tooltip.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        Main.layoutManager.addTopChrome(this._tooltip);
        this._measure = new St.Label({style_class: 'workspace-title-body', visible: false});
        this._measure.clutter_text.line_wrap = true;
        this._measure.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._measure.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        Main.uiGroup.add_child(this._measure);
        const owner = this;
        // Overview's layout caps the requested height using this getter. Reserve
        // the label row there as well, but keep Shell's thumbnail scale intact
        // while its own allocator runs. Preferred sizes must not depend on
        // whether we are allocating: Clutter caches them across both contexts.
        this._scaleDescriptor = Object.getOwnPropertyDescriptor(ThumbnailsBox.prototype, 'maxThumbnailScale');
        Object.defineProperty(ThumbnailsBox.prototype, 'maxThumbnailScale', {
            configurable: true,
            get() {
                owner._resize(this);
                const original = owner._scaleDescriptor.get.call(this);
                if (!this._thumbnails.length)
                    return original;
                const height = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex)?.height || global.stage.height;
                return original + (owner._allocating === this ? 0 : owner._rowHeight(this) / height);
            },
        });
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'vfunc_get_preferred_height', original => function (width) {
            if (!this._thumbnails.length)
                return [0, 0];
            owner._resize(this);
            const heights = original.call(this, width);
            const extra = owner._rowHeight(this);
            return heights.map(height => height + extra);
        });
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'vfunc_get_preferred_width', original => function (height) {
            owner._resize(this);
            return original.call(this, height);
        });
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'addThumbnails', original => function (...args) {
            original.apply(this, args);
            owner._syncLabels(this);
        });
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'vfunc_allocate', original => function (box) {
            owner._allocating = this;
            try {
                original.call(this, box);
            } finally {
                owner._allocating = null;
            }
            owner._allocate(this);
        });
        this.refresh();
    }

    _rowHeight(box) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const theme = box.get_theme_node();
        const padding = theme.get_vertical_padding() + theme.get_border_width(St.Side.TOP) + theme.get_border_width(St.Side.BOTTOM);
        const width = Math.max(1, Math.floor(box._maxThumbnailScale * box._porthole.width - padding * box._porthole.width / box._porthole.height) - 1);
        let height = 0;
        for (const thumbnail of box._thumbnails) {
            const text = this._title(thumbnail.metaWorkspace).text;
            const key = JSON.stringify([width, scale, text]);
            if (!this._measureCache.has(key)) {
                // Changing an actor's text while measuring a parent invalidates
                // the stage's ongoing allocation. Measure a detached Pango
                // layout instead, leaving the actor tree unchanged.
                const layout = this._measure.clutter_text.get_layout().copy();
                layout.set_text(text, -1);
                layout.set_width(width * Pango.SCALE);
                this._measureCache.set(key, text ? layout.get_pixel_size()[1] : 0);
            }
            height = Math.max(height, this._measureCache.get(key));
        }
        return 32 * scale + height;
    }

    _resize(box) {
        if (!box._porthole || !box._thumbnails.length)
            return;
        if (!this._boxes.has(box)) {
            const signal = box.connect('destroy', () => this._boxes.delete(box));
            this._boxes.set(box, {scale: box._maxThumbnailScale, signal});
        }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const area = Main.layoutManager.getWorkAreaForMonitor(box._monitorIndex);
        const count = box._thumbnails.length;
        const spacing = box.get_theme_node().get_length('spacing');
        const width = Math.min(210 * scale, Math.max(1, (area.width - 64 * scale - spacing * (count - 1)) / count));
        box._maxThumbnailScale = width / box._porthole.width;
    }

    refresh() {
        this._measure.ensure_style();
        this._records = [];
        let enumerator;
        try {
            enumerator = this._directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null))) {
                if (!info.get_name().endsWith('.json'))
                    continue;
                try {
                    const [, contents] = this._directory.get_child(info.get_name()).load_contents(null);
                    const record = JSON.parse(new TextDecoder().decode(contents));
                    if (record.shell_session !== this._session)
                        continue;
                    record.terminal = info.get_name();
                    for (const collection of [record.shells ?? {}, record.summaries ?? {}]) {
                        for (const [key, entry] of Object.entries(collection)) {
                            if (!this._isAlive(entry))
                                delete collection[key];
                        }
                    }
                    this._records.push(record);
                } catch (_) {
                    // An exited shell, incomplete external file, or concurrent removal.
                }
            }
        } catch (error) {
            console.error(`[Workspace Titles] ${error.message}`);
        } finally {
            enumerator?.close(null);
        }
        this._measureCache.clear();
        for (const [thumbnail, label] of this._labels)
            this._updateLabel(thumbnail, label);
        for (const box of this._boxes.keys()) {
            this._syncLabels(box);
            box.queue_relayout();
        }
    }

    _isAlive(entry) {
        if (!entry || typeof entry !== 'object')
            return false;
        if (!entry.pid)
            return true;
        try {
            const [ok, stat] = GLib.file_get_contents("/proc/" + entry.pid + "/stat");
            const fields = new TextDecoder().decode(stat).split(')').pop().trim().split(/\s+/);
            return ok && fields[19] === entry.start && !['Z', 'X'].includes(fields[0]);
        } catch (_) {
            return false;
        }
    }

    _updateLabel(thumbnail, label) {
        const title = this._title(thumbnail.metaWorkspace);
        label._heading.text = title.heading;
        label._body.text = title.text;
        label.accessible_name = title.text || title.heading;
    }

    _hideTooltip() {
        if (this._tooltipTimeout) {
            GLib.source_remove(this._tooltipTimeout);
            this._tooltipTimeout = 0;
        }
        this._tooltip.hide();
    }

    _hoverLabel(label) {
        this._hideTooltip();
        if (!label.hover)
            return;
        this._tooltipTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            this._tooltipTimeout = 0;
            if (!label.hover || !Main.overview.visible)
                return GLib.SOURCE_REMOVE;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            this._tooltip.text = label._body.text;
            this._tooltip.clutter_text.set_color(this._tooltip.get_theme_node().get_foreground_color());
            this._tooltip.width = Math.min(480 * scale, global.stage.width - 24 * scale);
            const [x, y] = label.get_transformed_position();
            const [, height] = this._tooltip.get_preferred_height(this._tooltip.width);
            this._tooltip.set_position(
                Math.max(12 * scale, Math.min(x + (label.width - this._tooltip.width) / 2, global.stage.width - this._tooltip.width - 12 * scale)),
                Math.min(y + label.height + 6 * scale, global.stage.height - height - 12 * scale));
            this._tooltip.show();
            return GLib.SOURCE_REMOVE;
        });
    }

    _title(workspace) {
        const windowIds = workspace.list_windows().map(window => window.get_stable_sequence());
        return selectTitle(this._records, windowIds, workspace.index(), this._settings.get_strv('workspace-names'), GLib.get_home_dir());
    }

    _syncLabels(box) {
        for (const thumbnail of box._thumbnails) {
            let label = this._labels.get(thumbnail);
            if (!label) {
                label = new St.BoxLayout({style_class: 'workspace-title-label', vertical: true, reactive: true, track_hover: true});
                label._heading = new St.Label({style_class: 'workspace-title-heading'});
                label._body = new St.Label({style_class: 'workspace-title-body'});
                for (const line of [label._heading, label._body]) {
                    line.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                    line.clutter_text.single_line_mode = false;
                    line.clutter_text.line_wrap = true;
                    line.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                    label.add_child(line);
                }
                label.connect('notify::hover', () => this._hoverLabel(label));
                box.add_child(label);
                this._labels.set(thumbnail, label);
                label._thumbnailSignal = thumbnail.connect('destroy', () => {
                    this._hideTooltip();
                    this._labels.delete(thumbnail);
                    label.destroy();
                });
            }
            this._updateLabel(thumbnail, label);
        }
    }

    _allocate(box) {
        if (!box._thumbnails.length)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const rowHeight = this._rowHeight(box);
        for (const thumbnail of box._thumbnails) {
            const label = this._labels.get(thumbnail);
            if (!label)
                continue;
            label.opacity = Math.round(thumbnail.opacity * box.expandFraction * (1 - thumbnail.collapse_fraction));
            const bounds = thumbnail.get_allocation_box();
            const allocation = new Clutter.ActorBox();
            allocation.x1 = bounds.x1;
            allocation.x2 = bounds.x2;
            allocation.y1 = bounds.y2 + 5 * scale;
            allocation.y2 = allocation.y1 + rowHeight - 5 * scale;
            label.allocate(allocation);
        }
    }

    destroy() {
        this._injections.clear();
        Object.defineProperty(ThumbnailsBox.prototype, 'maxThumbnailScale', this._scaleDescriptor);
        for (const [box, saved] of this._boxes) {
            box._maxThumbnailScale = saved.scale;
            box.disconnect(saved.signal);
            box.queue_relayout();
        }
        this._boxes.clear();
        this._hideTooltip();
        Main.layoutManager.removeChrome(this._tooltip);
        this._tooltip.destroy();
        this._measure.destroy();
        this._measureCache.clear();
        this._monitor.cancel();
        GLib.source_remove(this._livenessTimer);
        if (this._pending)
            GLib.source_remove(this._pending);
        Main.overview.disconnect(this._overviewSignal);
        Main.overview.disconnect(this._hiddenSignal);
        this._settings.disconnect(this._settingsSignal);
        for (const [thumbnail, label] of this._labels) {
            thumbnail.disconnect(label._thumbnailSignal);
            const parent = label.get_parent();
            label.destroy();
            parent?.queue_relayout();
        }
        this._labels.clear();
    }
}
