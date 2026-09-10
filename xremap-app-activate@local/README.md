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

## Tilix のアクティブな cwd を VS Code で開く

`Ctrl＋かな＋v` は `OpenTilixCwdInCode()` を呼び、呼び出し時にフォーカスしている
Tilix ウィンドウのアクティブなタブ・ペインの cwd を VS Code の新規ウィンドウで開く。
Tilix 以外にフォーカスしているときは何もしない。既存の `かな＋v` と `Shift＋かな＋v` は別操作。
fish の bind やプロセスの `/proc/PID/cwd` は使わず、Codex などが実行中でも利用できる。
取得するのは Tilix が OSC 7 で把握した cwd。子コマンドに指定された作業ディレクトリは追跡しない。

Tilix の `app-title` に、次の形式を設定する。ウィンドウの見出しにもホスト名とフルパスが表示される。
設定は全 Tilix ウィンドウに適用されるが、フォルダーの既定アプリは変更しない。
拡張のインストール先はこのディレクトリへの symlink。コード反映後は再ログインする。
xremap のホーム側と `~/d/ho/` 側を同期し、`/etc/` への配置は xremap の README に従う。

以下は Fish / Bash 共通。

```sh
# cwd の取得形式を設定（通常セッション）
gsettings set com.gexperts.Tilix.Settings app-title 'Tilix [code-cwd:${hostname}] ${directory} [code-cwd-end]'
# フォーカス中の Tilix に対して実行。成功時は (true,)
gdbus call --session --dest org.gnome.Shell --object-path /com/wataash/XremapAppActivate --method com.wataash.XremapAppActivate.OpenTilixCwdInCode
# 導入前のタイトルへ戻す（その後この操作は false を返す）
gsettings set com.gexperts.Tilix.Settings app-title '${appName}: ${sessionName}'
```

`Meta.Window.get_title()` から全体を読み、形式・ローカルホスト名・絶対パス・ディレクトリの存在を確認する。
過去のタイトルや別ウィンドウの状態にはフォールバックしない。
GAppInfo に固定の `/bin/code --new-window %f` と `Gio.File` を別々に渡すため、
空白・日本語・引用符・`$()` などはパスの一部であり、シェルとして実行しない。
絶対パスのみを許可するため、パスが CLI オプションとして解釈されることもない。
GNOME の launch context を渡して Wayland の activation に対応する。

タイトルの扱いと制限:

- Tilix は cwd の更新とフォーカスペイン・タブの変更でタイトルを更新する。
  見出しの表示上の省略や非表示は、取得するウィンドウタイトルとは別。
- Codex や fish が送る端末タイトル（OSC 0/2）、端末の手動タイトル、セッション名は取得形式に含めない。
  **ウィンドウタイトル自体の手動上書きは使わない**。通常の手動タイトルは形式不一致となる。
  cwd 取得形式を模した固定タイトルも設定しないこと。動的な cwd との区別はできない。
- SSH 先のホスト名が入ったタイトルは拒否する。`${directory}` は remote cwd にも切り替わるため、
  `terminal-file-browser` の `currentLocalDirectory` と完全には同じでない。
- cwd 通知がない端末・消えたディレクトリ・制御文字を含むパスは開かない。
  Tilix の変数記法 `${...}` を含むディレクトリ名は対象外。
  特に `${sessionName}`・`${sessionNumber}`・`${sessionCount}` は Tilix 自身が cwd 挿入後にも展開するため、元の名前を復元できない。
- D-Bus 呼び出しが Shell に届いた時点のフォーカスが対象。キー押下直後に別のウィンドウへ切り替えると対象も変わり得る。

取得仕様の根拠: [Tilix title documentation](https://gnunn1.github.io/tilix-web/manual/title/)、
[`terminal.d`](https://github.com/gnunn1/tilix/blob/master/source/gx/tilix/terminal/terminal.d) の `replaceVariables`・cwd 通知処理、
[`session.d`](https://github.com/gnunn1/tilix/blob/master/source/gx/tilix/session.d) の `getDisplayText`、
[`appwindow.d`](https://github.com/gnunn1/tilix/blob/master/source/gx/tilix/appwindow.d) の `getDisplayTitle`・`updateTitle`。

検証: `node tests/test_tilix_cwd.mjs`（repo root、Fish / Bash 共通）。
実機の GNOME 50 / Tilix 1.9.6 の `gnome-shell --wayland --devkit` では、
専用 D-Bus・runtime・GSettings と起動引数記録用コマンドを使い、2 ウィンドウ・2 タブ・分割ペイン間の
切り替え、実行中コマンドからの cwd 通知、空白・日本語・シェル特殊文字・長いパス、別ホスト・存在しない cwd の拒否を確認した。
さらに専用 user-data-dir の実際の VS Code で、特殊文字を含む対象フォルダーだけが新規ウィンドウに開くことと、
VS Code にフォーカスした状態での呼び出しが false になることを確認した。
自動テストでは `ActivateTerminal` の受付後、対象タイトルへの更新を待ってから呼び出す。
