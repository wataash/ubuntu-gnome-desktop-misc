# agent_workspace_speak.py

hook は sbx に入る前に親 agent の `/proc/$PPID/stat` を読み、`--setenv AGENT_PROCESS_STAT "$(cat /proc/$PPID/stat)"` で渡す。これを `agent_process_stat` として保存し、activate 側で agent の生存確認に使う。ホストの `/proc/` を sandbox に公開する必要はない。

Codex / Claude Code の hook から使い、タスクを送信した GNOME workspace の番号をタスク完了時に英語で読み上げる。

`UserPromptSubmit` で `remember`、`Stop` で `speak` を呼ぶ。既存の完了音もこのスクリプトから鳴らす場合は `speak` の代わりに `notify` を使う。hook が標準入力に渡す JSON の `session_id` / `thread_id` ごとに、Tilix windowのstable sequence、workspace番号、prompt待ちかどうかを `$XDG_RUNTIME_DIR/agent-workspaces/` へ保存する。`remember` では `waiting: false`、`speak` / `notify` では `waiting: true` とし、後者のfile mtimeが待機開始時刻になる。

`xremap-app-activate@local` GNOME Shell extensionは、Tilix windowのstable sequenceと現在のworkspaceを `$XDG_RUNTIME_DIR/agent-workspaces/window-state.json` へ随時書く。`remember` はfocused Tilix windowを記録し、`speak` / `notify` は同じwindowの現在位置を読み上げるため、prompt送信後にwindowを別workspaceへ移動しても追従する。extensionのstateが使えない場合は、XWaylandルートウィンドウの `_NET_CURRENT_DESKTOP`（0始まり）を `xprop` で読み、1始まりに直す。

JSON parsing、session IDのhash、`xprop` outputのparseにはPython standard libraryを使う。読み上げには Speech Dispatcher の `spd-say` をvolume `-20`で使う。

hook は `/usr/local/bin/sbx` 経由で実行する。script、X11 socket、Xauthority、専用state directory、Speech Dispatcher socketだけを公開し、`notify` の場合のみPipeWire socketも公開する。D-Bus、home全体、host networkは公開しない。
