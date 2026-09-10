// SPDX-FileCopyrightText: Copyright (c) 2026 Wataru Ashihara <wataash0607@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WorkspaceTitles} from './workspaceTitles.js';
import {parseTilixCwd, TILIX_CWD_TITLE} from './tilixCwd.js';

const DBUS_XML = `
<node>
  <interface name="com.wataash.XremapAppActivate">
    <method name="Activate">
      <arg type="s" direction="in" name="desktop_id"/>
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="ActivateOnWorkspace">
      <arg type="s" direction="in" name="desktop_id"/>
      <arg type="u" direction="in" name="workspace_index"/>
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="ActivateWindow">
      <arg type="u" direction="in" name="stable_sequence"/>
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="ActivateTerminal">
      <arg type="s" direction="in" name="terminal_uuid"/>
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="GetFocusedMonitor">
      <arg type="s" direction="out" name="connector"/>
    </method>
    <method name="OpenTilixCwdInCode">
      <arg type="b" direction="out" name="success"/>
    </method>
  </interface>
</node>`;

export default class XremapAppActivateExtension extends Extension {
    enable() {
        this._shellSession = GLib.uuid_string_random();
        this._titles = new WorkspaceTitles(this._shellSession);
        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_XML, this);
        this._dbus.export(Gio.DBus.session, '/com/wataash/XremapAppActivate');
        this._windowSignals = new Map();
        this._displaySignals = [
            global.display.connect('window-created', (_display, window) => {
                this._watchWindow(window);
                this._writeWindowState();
            }),
            global.display.connect('notify::focus-window', () => {
                const window = global.display.focus_window;
                if (window)
                    this._watchWindow(window);
                this._writeWindowState();
            }),
        ];
        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);
        this._writeWindowState();
    }

    disable() {
        this._titles?.destroy();
        this._titles = null;
        for (const signal of this._displaySignals ?? [])
            global.display.disconnect(signal);
        for (const [window, signals] of this._windowSignals ?? [])
            for (const signal of signals)
                window.disconnect(signal);
        this._displaySignals = null;
        this._windowSignals = null;
        this._dbus?.flush();
        this._dbus?.unexport();
        this._dbus = null;
    }

    Activate(desktopId) {
        const app = Shell.AppSystem.get_default().lookup_app(desktopId);
        if (!app) {
            console.error(`[Xremap App Activate] Application not found: ${desktopId}`);
            Main.notify('Xremap App Activate', `Application not found: ${desktopId}`);
            return false;
        }

        const windows = app.get_windows();
        if (windows.length > 0)
            Main.activateWindow(windows[0]);
        else
            app.activate();

        return true;
    }

    ActivateOnWorkspace(desktopId, workspaceIndex) {
        const app = Shell.AppSystem.get_default().lookup_app(desktopId);
        if (!app) {
            console.error(`[Xremap App Activate] Application not found: ${desktopId}`);
            return false;
        }

        const window = app.get_windows().find(
            candidate => candidate.get_workspace()?.index() === workspaceIndex
        );
        if (!window) {
            console.error(`[Xremap App Activate] Window not found: ${desktopId}, workspace ${workspaceIndex}`);
            return false;
        }
        Main.activateWindow(window);
        return true;
    }

    ActivateWindow(stableSequence) {
        const window = this._tilixWindows().find(
            candidate => candidate.get_stable_sequence() === stableSequence
        );
        if (!window) {
            console.error(`[Xremap App Activate] Window not found: stable sequence ${stableSequence}`);
            return false;
        }
        Main.activateWindow(window);
        return true;
    }

    ActivateTerminalAsync([terminalUuid], invocation) {
        const app = Shell.AppSystem.get_default().lookup_app('com.gexperts.Tilix.desktop');
        if (!app || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(terminalUuid)) {
            invocation.return_value(new GLib.Variant('(b)', [false]));
            return;
        }
        // Shell supplies a compositor-issued activation token for Wayland.
        // Calling Tilix directly without it only raises an "is ready" notice.
        app.activate_action('activate-terminal',
            new GLib.Variant('av', [new GLib.Variant('s', terminalUuid)]),
            global.display.get_current_time_roundtrip(), -1, null, (source, result) => {
                let success = false;
                try {
                    success = source.activate_action_finish(result);
                } catch (error) {
                    console.error(`[Xremap App Activate] ${error.message}`);
                }
                invocation.return_value(new GLib.Variant('(b)', [success]));
            });
    }

    OpenTilixCwdInCode() {
        // Capture the focused window once; never fall back to another Tilix window.
        const window = global.display.focus_window;
        if (!window || !this._isTilixWindow(window))
            return false;
        try {
            const settings = new Gio.Settings({schema_id: 'com.gexperts.Tilix.Settings'});
            if (settings.get_string('app-title') !== TILIX_CWD_TITLE)
                throw new Error('Tilix の app-title に cwd 取得用の形式を設定してください。');
            const cwd = parseTilixCwd(window.get_title(), GLib.get_host_name());
            const folder = Gio.File.new_for_path(cwd);
            if (folder.query_file_type(Gio.FileQueryInfoFlags.NONE, null) !== Gio.FileType.DIRECTORY)
                throw new Error('Tilix の cwd が存在しないか、ディレクトリではありません。');
            // GAppInfo expands %f into one argv entry. No title text is shell code.
            const app = Gio.AppInfo.create_from_commandline(
                '/bin/code --new-window %f', 'VS Code', Gio.AppInfoCreateFlags.NONE);
            const context = global.create_app_launch_context(
                global.display.get_current_time_roundtrip(), window.get_workspace().index());
            return app.launch([folder], context);
        } catch (error) {
            console.error(`[Xremap App Activate] ${error.message}`);
            Main.notify('Tilix → VS Code', error.message);
            return false;
        }
    }

    _tilixWindows() {
        return global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => this._isTilixWindow(window));
    }

    _isTilixWindow(window) {
        return Shell.WindowTracker.get_default().get_window_app(window)?.get_id() === 'com.gexperts.Tilix.desktop';
    }

    _watchWindow(window) {
        if (!this._isTilixWindow(window) || this._windowSignals.has(window))
            return;
        const workspaceChanged = window.connect('workspace-changed', () => this._writeWindowState());
        const unmanaged = window.connect('unmanaged', () => {
            this._windowSignals.delete(window);
            this._writeWindowState();
        });
        this._windowSignals.set(window, [workspaceChanged, unmanaged]);
    }

    _writeWindowState() {
        const windows = {};
        for (const window of this._tilixWindows()) {
            const workspace = window.get_workspace()?.index();
            if (workspace !== undefined && workspace >= 0)
                windows[window.get_stable_sequence()] = workspace + 1;
        }
        const focused = global.display.focus_window;
        const focusedSequence = focused && Object.hasOwn(windows, focused.get_stable_sequence())
            ? focused.get_stable_sequence()
            : null;
        const directory = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'agent-workspaces']);
        GLib.mkdir_with_parents(directory, 0o700);
        const file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'window-state.json']));
        try {
            file.replace_contents(
                JSON.stringify({focused: focusedSequence, windows, terminal_activation: true, shell_session: this._shellSession}) + '\n',
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (error) {
            console.error(`[Xremap App Activate] Could not save window state: ${error.message}`);
        }
        this._titles?.refresh();
    }

    GetFocusedMonitor() {
        let monitorNumber = global.display.focus_window?.get_monitor();
        if (monitorNumber === undefined || monitorNumber < 0)
            monitorNumber = global.display.get_primary_monitor();

        const monitorManager = global.backend.get_monitor_manager();
        const logicalMonitors = monitorManager.get_logical_monitors();
        const logicalMonitor =
            logicalMonitors.find(monitor => monitor.get_number() === monitorNumber) ??
            logicalMonitors[monitorNumber] ??
            logicalMonitors[0];
        const [monitor] = logicalMonitor?.get_monitors() ?? [];

        return monitor?.get_connector() ?? '';
    }
}
