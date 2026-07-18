import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const TasksIndicator = GObject.registerClass(
class TasksIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Mini Tasks', false);

        this._tasks = [];
        this._editingIndex = -1;
        this._searchVisible = false;
        this._searchQuery = '';

        this._icon = new St.Icon({
            icon_name: 'checkbox-checked-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();
        this._loadTasks();
    }

    _buildMenu() {
        this._entryItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
        });

        this._entry = new St.Entry({
            hint_text: 'Add a task and press Enter…',
            can_focus: true,
            x_expand: true,
            style_class: 'mini-tasks-entry',
        });

        this._entry.clutter_text.connect('activate', () => {
            this._commitEntry();
        });

        this._entry.clutter_text.connect('key-press-event', (actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape && this._editingIndex >= 0) {
                this._cancelEdit();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        const searchToggleIcon = new St.Icon({
            icon_name: 'edit-find-symbolic',
            style_class: 'popup-menu-icon',
        });
        this._searchToggle = new St.Button({
            child: searchToggleIcon,
            style_class: 'mini-tasks-icon-button',
            can_focus: false,
        });
        this._searchToggle.connect('clicked', () => this._toggleSearch());

        this._entryItem.add_child(this._entry);
        this._entryItem.add_child(this._searchToggle);
        this.menu.addMenuItem(this._entryItem);

        this._searchItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
        });
        this._searchEntry = new St.Entry({
            hint_text: 'Search tasks…',
            can_focus: true,
            x_expand: true,
            style_class: 'mini-tasks-entry',
        });
        this._searchEntry.clutter_text.connect('text-changed', () => {
            this._searchQuery = this._searchEntry.get_text().toLowerCase();
            this._renderTasks();
        });
        this._searchItem.add_child(this._searchEntry);
        this._searchItem.visible = false;
        this.menu.addMenuItem(this._searchItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._taskSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._taskSection);

        this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    global.stage.set_key_focus(this._entry.clutter_text);
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._cancelEdit();
            }
        });
    }

    _toggleSearch() {
        this._searchVisible = !this._searchVisible;
        this._searchItem.visible = this._searchVisible;
        if (this._searchVisible) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                global.stage.set_key_focus(this._searchEntry.clutter_text);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._searchEntry.set_text('');
            this._searchQuery = '';
            this._renderTasks();
        }
    }

    _commitEntry() {
        const text = this._entry.get_text().trim();
        if (!text)
            return;

        if (this._editingIndex >= 0) {
            this._tasks[this._editingIndex].text = text;
            this._editingIndex = -1;
            this._entry.set_hint_text('Add a task and press Enter…');
        } else {
            this._tasks.push({text, done: false});
        }

        this._entry.set_text('');
        this._saveTasks();
        this._renderTasks();
    }

    _cancelEdit() {
        if (this._editingIndex < 0)
            return;
        this._editingIndex = -1;
        this._entry.set_text('');
        this._entry.set_hint_text('Add a task and press Enter…');
    }

    _startEdit(index) {
        this._editingIndex = index;
        this._entry.set_text(this._tasks[index].text);
        this._entry.set_hint_text('Editing task — Enter to save, Esc to cancel');
        global.stage.set_key_focus(this._entry.clutter_text);
        this._entry.clutter_text.set_selection(0, this._tasks[index].text.length);
    }

    _copyTask(index) {
        St.Clipboard.get_default().set_text(
            St.ClipboardType.CLIPBOARD, this._tasks[index].text);
    }

    _removeTask(index) {
        if (this._editingIndex === index)
            this._cancelEdit();
        this._tasks.splice(index, 1);
        this._saveTasks();
        this._renderTasks();
    }

    _toggleTask(index) {
        this._tasks[index].done = !this._tasks[index].done;
        this._saveTasks();
        this._renderTasks();
    }

    _renderTasks() {
        this._taskSection.removeAll();

        const visible = this._tasks
            .map((task, index) => ({task, index}))
            .filter(({task}) => !this._searchQuery ||
                task.text.toLowerCase().includes(this._searchQuery));

        if (visible.length === 0) {
            const message = this._searchQuery ? 'No matching tasks' : 'No tasks yet';
            const empty = new PopupMenu.PopupMenuItem(message, {
                reactive: false,
                can_focus: false,
            });
            empty.label.add_style_class_name('mini-tasks-empty');
            this._taskSection.addMenuItem(empty);
            this._updateIcon();
            return;
        }

        visible.forEach(({task, index}) => {
            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: true,
                can_focus: false,
                style_class: 'mini-tasks-row',
            });

            const checkIcon = new St.Icon({
                icon_name: task.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
                style_class: 'popup-menu-icon',
            });
            const checkButton = new St.Button({
                child: checkIcon,
                style_class: 'mini-tasks-icon-button',
                can_focus: false,
            });
            checkButton.connect('clicked', () => this._toggleTask(index));

            const label = new St.Label({
                text: task.text,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.set_line_wrap(true);
            if (task.done)
                label.add_style_class_name('mini-tasks-done');
            if (index === this._editingIndex)
                label.add_style_class_name('mini-tasks-editing');

            const editIcon = new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'popup-menu-icon',
            });
            const editButton = new St.Button({
                child: editIcon,
                style_class: 'mini-tasks-icon-button',
                can_focus: false,
            });
            editButton.connect('clicked', () => this._startEdit(index));

            const copyIcon = new St.Icon({
                icon_name: 'edit-copy-symbolic',
                style_class: 'popup-menu-icon',
            });
            const copyButton = new St.Button({
                child: copyIcon,
                style_class: 'mini-tasks-icon-button',
                can_focus: false,
            });
            copyButton.connect('clicked', () => this._copyTask(index));

            const deleteIcon = new St.Icon({
                icon_name: 'edit-delete-symbolic',
                style_class: 'popup-menu-icon',
            });
            const deleteButton = new St.Button({
                child: deleteIcon,
                style_class: 'mini-tasks-icon-button mini-tasks-delete-button',
                can_focus: false,
            });
            deleteButton.connect('clicked', () => this._removeTask(index));

            item.add_child(checkButton);
            item.add_child(label);
            item.add_child(editButton);
            item.add_child(copyButton);
            item.add_child(deleteButton);

            this._taskSection.addMenuItem(item);
        });

        this._updateIcon();
    }

    _updateIcon() {
        const remaining = this._tasks.filter(t => !t.done).length;
        this._icon.icon_name = remaining > 0
            ? 'checkbox-symbolic'
            : 'checkbox-checked-symbolic';
    }

    _getDataFile() {
        const dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'mini-tasks-gnome']);
        GLib.mkdir_with_parents(dir, 0o755);
        return Gio.File.new_for_path(GLib.build_filenamev([dir, 'tasks.json']));
    }

    _loadTasks() {
        try {
            const file = this._getDataFile();
            if (file.query_exists(null)) {
                const [ok, contents] = file.load_contents(null);
                if (ok) {
                    const text = new TextDecoder().decode(contents);
                    const parsed = JSON.parse(text);
                    if (Array.isArray(parsed))
                        this._tasks = parsed;
                }
            }
        } catch (e) {
            logError(e, 'Mini Tasks: failed to load tasks');
            this._tasks = [];
        }
        this._renderTasks();
    }

    _saveTasks() {
        try {
            const file = this._getDataFile();
            const contents = JSON.stringify(this._tasks, null, 2);
            file.replace_contents(
                contents, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            logError(e, 'Mini Tasks: failed to save tasks');
        }
    }
});

export default class MiniTasksExtension extends Extension {
    enable() {
        this._indicator = new TasksIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
