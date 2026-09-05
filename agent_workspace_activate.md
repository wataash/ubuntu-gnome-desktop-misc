# agent_workspace_activate.py

Codex / Claude Code が応答を完了してプロンプト待ちになっている workspace のうち、待ち時間が最も短い Tilix window を activate する。3秒以内に再実行すると待機時間が短い順で次の workspace へ進み、最後まで進むと先頭へ戻る。

待機状態は `agent_workspace_speak.py` が `$XDG_RUNTIME_DIR/agent-workspaces/` に保存する。`UserPromptSubmit` では `waiting: false`、`Stop` では `waiting: true` とし、Stop時のfile mtimeを待機開始時刻として使う。同じTilix windowに複数のセッションの記録がある場合は、file mtimeが最新の記録で判定する。最新の記録が `waiting: false` なら、古い待機記録が残っていてもactivateの対象にしない。

activateは `xremap-app-activate@local` GNOME Shell extensionの `ActivateWindow` D-Bus methodへstable sequenceを渡すため、Stop後にwindowを別workspaceへ移動しても追従する。stable sequenceを記録していない旧stateでは `ActivateOnWorkspace` へfallbackする。windowが存在しなければ次の候補を試す。連続実行の状態は `$XDG_RUNTIME_DIR/kana-agent-waiting.json` に保存する。
