# Xremap App Activate

GNOME Shell 内からapplication IDで対象アプリをactivateするD-Busメソッドを提供する。
起動済みなら直近のウィンドウをactivateし、未起動なら起動する。
focused windowがあるモニタのconnector名も取得できる。
application IDとworkspace indexを指定して、そのworkspace上のwindowをactivateすることもできる。
windowのstable sequenceを指定したactivateと、Tilix windowごとの現在のworkspaceをruntime fileへ保存する機能も提供する。

既存ウィンドウにはGNOME Shellの `Main.activateWindow()` を使い、
ウィンドウが存在しない場合だけ `Shell.App.activate()` で起動する。
application IDを引数で渡せるため、アプリ数に上限はない。
`ActivateOnWorkspace` のworkspace indexは0始まり。該当windowがなければ起動はせずfalseを返す。
`ActivateWindow` は `Meta.Window.get_stable_sequence()` の値を受け取り、windowをworkspace間で移動した後も同じwindowをactivateする。
`ActivateTerminal` は Tilix の terminal UUID を受け取り、`Shell.App.activate_action()` で compositor が発行した activation token を付けて `activate-terminal` を呼ぶ。Wayland のフォーカス抑止で通知だけになることを防ぐ。時刻は `global.display.get_current_time_roundtrip()` で取得する。戻り値は D-Bus 呼び出しの成功を示し、存在しない terminal UUID の検出はできない。
Tilix windowのstable sequence、1始まりのworkspace番号、focused windowは `$XDG_RUNTIME_DIR/agent-workspaces/window-state.json` に保存する。
同ファイルの `terminal_activation: true` は `ActivateTerminal` が利用可能なことを示す。

## 導入

新規拡張をGNOME Shellに認識させるため、一度ログアウトしてログインする。

```sh
gnome-extensions enable xremap-app-activate@local
gnome-extensions info xremap-app-activate@local
```

通常のWaylandセッションへコード変更を反映するには、ログアウト・ログインが必要。

## 再ログインせずにテスト

専用の D-Bus、runtime directory、メモリ上の GSettings を使う。
通常セッションの `agent-workspaces/` や xremap socket を共有しないため、
検証対象の拡張だけを有効にする。`xremap@k0kubun.com` は有効にしない。
`--devkit` の表示にはホストの Wayland と PipeWire への接続が必要。

次の起動コマンドは Fish / Bash 共通。通常セッションの `WAYLAND_DISPLAY` が
`wayland-0` のような相対名の場合の例。

```sh
mkdir -p /tmp/xremap-activate-test/
chmod 700 /tmp/xremap-activate-test/
WAYLAND_DISPLAY="$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" PIPEWIRE_RUNTIME_DIR="$XDG_RUNTIME_DIR" XDG_RUNTIME_DIR=/tmp/xremap-activate-test/ GSETTINGS_BACKEND=memory dbus-run-session -- bash

# ここから専用 D-Bus セッション内の Bash
# 親 Wayland 上に検証用 GNOME ウィンドウを表示する
gnome-shell --wayland --devkit --wayland-display=qa-wayland --virtual-monitor=1024x768 --mode=user &
gdbus wait --session org.gnome.Shell
gnome-extensions enable xremap-app-activate@local
gnome-extensions info xremap-app-activate@local

# 検証用 GNOME の Wayland socket に Tilix を接続する
WAYLAND_DISPLAY=qa-wayland GDK_BACKEND=wayland tilix

# テスト終了時は検証用 GNOME だけを終了し、専用シェルを抜ける
fg
# Ctrl-C
exit
```

検証用 Tilix 内の `TILIX_ID` を使って `ActivateTerminal` を呼び、
専用 runtime の `agent-workspaces/window-state.json` の `focused` が対象 window に変わることを確認する。
D-Bus の `(true,)` だけではフォーカス成功の確認にならない。
コードを変更したら検証用 GNOME だけを再起動する。

2026-09-09、GNOME 50.1 の表示付き nested Wayland で確認済み:

- `ActivateTerminal` による2つの Tilix 間のフォーカス移動（1 → 2 → 1）。
- 生存中のテスト用 agent プロセスと terminal UUID、存在しない保存済み window ID を使った `agent_workspace_activate.py` の巡回（2 → 1 → 2）。
- 通常セッションの xremap socket は検証前後で変更なし。

## 動作確認

```sh
# Chrome
gdbus call --session --dest org.gnome.Shell --object-path /com/wataash/XremapAppActivate --method com.wataash.XremapAppActivate.Activate google-chrome.desktop
# (true,)

journalctl --user -b /usr/bin/gnome-shell | rg 'Xremap App Activate'
```

## xremapから呼ぶ

```yaml
KATAKANAHIRAGANA-b:
  launch:
    - /bin/gdbus
    - call
    - --session
    - --dest
    - org.gnome.Shell
    - --object-path
    - /com/wataash/XremapAppActivate
    - --method
    - com.wataash.XremapAppActivate.Activate
    - google-chrome.desktop
```

system service構成ではユーザーセッション側のlaunch bridgeが必要。
