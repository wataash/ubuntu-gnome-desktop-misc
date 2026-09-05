import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CornerBlinkPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Corner Blink',
            description: '待機(消灯)。flash-trigger を bump すると一度だけ点滅する',
        });
        page.add(group);

        const size = new Adw.SpinRow({
            title: 'Dot size (px)',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 512, step_increment: 1}),
        });
        settings.bind('size', size, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(size);

        const color = new Adw.EntryRow({title: 'Flash color (CSS color)'});
        settings.bind('flash-color', color, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(color);

        const interval = new Adw.SpinRow({
            title: 'Flash interval (ms)',
            adjustment: new Gtk.Adjustment({lower: 50, upper: 10000, step_increment: 50}),
        });
        settings.bind('flash-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(interval);

        const duration = new Adw.SpinRow({
            title: 'Flash duration (ms); 0 で無効',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 60000, step_increment: 100}),
        });
        settings.bind('flash-duration', duration, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(duration);

        const indicator = new Adw.EntryRow({title: "Steady bottom-right indicator color ('' = hidden)"});
        settings.bind('indicator-color', indicator, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(indicator);

        const test = new Adw.ButtonRow({title: 'Test flash (bump flash-trigger)'});
        test.connect('activated', () => {
            settings.set_int('flash-trigger', settings.get_int('flash-trigger') + 1);
        });
        group.add(test);

        window.add(page);
    }
}
