# agent_workspace_activate.py

agent のプロセスが生存している Tilix だけを候補にする。hook が保存した `agent_process_stat` とホストの `/proc/PID/stat` の PID・起動時刻を照合し、終了済み、ゾンビ、PID 再利用、プロセス情報のない旧記録は除外する。既存セッションは更新後の hook が実行されると再登録される。

Codex / Claude Code が応答を完了してプロンプト待ちになっているもののうち、待ち時間が最も短い Tilix terminal を activate する。3秒以内に再実行すると待機時間が短い順で次の候補へ進み、最後まで進むと先頭へ戻る。

待機状態は `agent_workspace_speak.py` が `$XDG_RUNTIME_DIR/agent-workspaces/` に保存する。`UserPromptSubmit` では `waiting: false`、`Stop` では `waiting: true` とし、Stop時のfile mtimeを待機開始時刻として使う。同じ terminal（terminal ID を取得できない場合は同じ window）に複数のセッションの記録がある場合は、file mtimeが最新の記録で判定する。最新の記録が `waiting: false` なら、古い待機記録が残っていてもactivateの対象にしない。

生存確認した agent の `/proc/PID/environ` から `TILIX_ID` を取得し、GNOME 拡張の `ActivateTerminal` へ terminal UUID を渡す。拡張は `Shell.App.activate_action()` で正規の activation token を付けて Tilix の `activate-terminal` を呼ぶ。この ID は terminal を別 window へ移動しても維持されるため、保存済み window が消えていても移動先を activate できる。既存の hook 記録からも利用でき、再登録は不要。[Tilix の実装](https://github.com/gnunn1/tilix/blob/master/source/gx/tilix/application.d) は各 window から該当 terminal を探して activate する。D-Bus の戻り値は受付成功だけを示し、terminal の存在確認結果は返さない。

`TILIX_ID` を取得できない場合は `xremap-app-activate@local` GNOME Shell extension の `ActivateWindow` へ保存済み stable sequence を渡す。正の整数の window ID もない記録は候補から除外する。workspace だけでは対象 terminal を特定できないため。window が存在しなければ次の候補を試す。連続実行の状態は `$XDG_RUNTIME_DIR/kana-agent-waiting.json` に保存する。

Wayland では Tilix へ直接 D-Bus 要求を送ると「is ready」の通知だけになることがあるため、[GNOME Shell の起動処理](https://github.com/GNOME/gnome-shell/blob/main/src/shell-app.c) を使う。拡張は `window-state.json` の `terminal_activation: true` で新 API の利用可否を知らせる。拡張変更の反映にはログアウト・ログインが必要で、それまでは保存済み window による切り替えを使う。反映前は terminal を別 window へ移した場合の追跡はできない。

activateすべき候補が一つもないときは `pw-play` で `/usr/share/sounds/freedesktop/stereo/message.oga` を鳴らし、何も起きなかったことを知らせる。
