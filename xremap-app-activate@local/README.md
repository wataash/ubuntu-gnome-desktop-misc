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
Tilix windowのstable sequence、1始まりのworkspace番号、focused windowは `$XDG_RUNTIME_DIR/agent-workspaces/window-state.json` に保存する。

## 導入

新規拡張をGNOME Shellに認識させるため、一度ログアウトしてログインする。

```sh
gnome-extensions enable xremap-app-activate@local
gnome-extensions info xremap-app-activate@local
```

通常のWaylandセッションへコード変更を反映するには、ログアウト・ログインが必要。

## 再ログインせずにテスト

専用のD-BusセッションとネストしたGNOME Shellを起動する。
通常のGNOME Shellは終了しない。

```sh
dbus-run-session -- gnome-shell --wayland --devkit
```

モニタ取得をテストするときは仮想モニタを明示する。

```sh
dbus-run-session -- gnome-shell --wayland --devkit --virtual-monitor=1920x1080
```

ネストしたGNOME Shell内で端末を開き、拡張を有効化してテストする。
この端末から実行すれば、`gdbus --session` はネストしたGNOME Shellの
セッションバスへ接続する。

```sh
gnome-extensions enable xremap-app-activate@local
gnome-extensions info xremap-app-activate@local

gdbus call --session --dest org.gnome.Shell --object-path /com/wataash/XremapAppActivate --method com.wataash.XremapAppActivate.Activate code.desktop
# (true,)

gdbus call --session --dest org.gnome.Shell --object-path /com/wataash/XremapAppActivate --method com.wataash.XremapAppActivate.GetFocusedMonitor
# ('DP-1',)
```

ホスト側の端末で直接 `gdbus` も実行したい場合は、先に
`dbus-run-session` 内の対話シェルへ入る。

```sh
dbus-run-session -- bash

# ここから専用D-Busセッション内
gnome-shell --wayland --devkit &
gdbus wait --session org.gnome.Shell
gnome-extensions enable xremap-app-activate@local

gdbus call --session --dest org.gnome.Shell --object-path /com/wataash/XremapAppActivate --method com.wataash.XremapAppActivate.Activate code.desktop

gdbus call --session --dest org.gnome.Shell --object-path /com/wataash/XremapAppActivate --method com.wataash.XremapAppActivate.GetFocusedMonitor
```

テスト終了時は `fg` でGNOME Shellをフォアグラウンドへ戻して
`Ctrl-C` で終了し、対話シェルも `exit` する。
コードを再変更した場合は、ネストしたGNOME Shellだけを再起動する。

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
