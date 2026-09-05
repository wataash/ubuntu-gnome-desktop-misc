# corner-blink

画面四隅に点を点滅表示する。既定では**待機(消灯)**で、`flash-trigger` を別の値に書き換えると一度だけ点滅する(`flash-duration` で自動停止)。また `indicator-color` を非空にすると、右下隅のみに常時表示の点を出す(空文字で消灯)。

- `extension.js` … 本体
- `prefs.js` … 設定 GUI
- `schemas/` … GSettings スキーマ (要 `glib-compile-schemas`)
- `metadata.json` … `session-modes` に `unlock-dialog` を含めることでロック画面でも動き続ける。`settings-schema` で GSettings スキーマを指定

## インストール

このディレクトリの中身を拡張機能ディレクトリに UUID 名 (`corner-blink@local`) で配置する。

```sh
glib-compile-schemas ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas/
```

### 反映 (Wayland)

GNOME (Wayland) では、新規ローカル拡張を実行中の gnome-shell に後入れ／即ロードする方法は**存在しない** (GNOME 公式の制約)。

- `ReloadExtension` D-Bus … deprecated で動かない
- `Eval` / unsafe mode … 既定でオフ
- `Meta.restart()` … Wayland では無効
- extensions.gnome.org の Web インストールだけ再起動不要 (`InstallRemoteExtension` 経由)。ローカル拡張はこの経路を通らない

→ **初回のみログアウト→ログイン** が必要。その後は永続。

```sh
# ログイン後に有効化 (一度だけ)
gnome-extensions enable corner-blink@local
```

Xorg セッションなら `Alt+F2 → r` でシェル再起動でも反映できる。

### js の変更を反映するには (重要)

`extension.js` を編集しても、実行中の gnome-shell には自動で反映されない。

- **`disable` → `enable` では反映されない**。`disable()`/`enable()` 関数が呼び直されるだけで、once import 済みの `extension.js` モジュールは gnome-shell にキャッシュされたまま再評価されないため、コード自体の変更は効かない。
- 確実に反映する唯一の方法は **ログアウト→ログイン** (Wayland)。Xorg なら `Alt+F2 → r`。
- なお `size`/`flash-*` は GSettings 管理なので、これらの**値の変更**はコード再評価不要で即反映される (「設定」を参照)。ログアウトが要るのは `extension.js` 等のコードを書き換えたとき。

### ログアウトせずにテストする (dbus-run-session + devkit)

入れ子の gnome-shell を別ウィンドウで起動してテストできる。本体セッションには影響しない。コードを編集するたびにこのウィンドウを閉じて開き直せば、毎回 js が読み直される。

```sh
# 補助バイナリ /usr/libexec/mutter-devkit が必要 (未導入なら)
sudo apt install mutter-dev-bin

# 入れ子の gnome-shell を起動
dbus-run-session -- gnome-shell --wayland --devkit

gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink indicator-color blue
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink indicator-color ''
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink flash-color green
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink flash-interval 200
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink flash-duration 800
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink flash-trigger $(( $(gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas get org.gnome.shell.extensions.corner-blink flash-trigger) + 1 ))
```

注意点:

- `--nested` は mutter 50 で削除されたため、後継の `--devkit` を使う。
- `--devkit` 無しの素の `--wayland` だと native ディスプレイサーバとして起動しようとし、本体セッションと衝突して `Failed to take control of the session: EBUSY` で失敗する。
- `mutter-dev-bin` 未導入だと `Failed to launch devkit: ... /usr/libexec/mutter-devkit (No such file or directory)` でウィンドウが出ない。
- **点滅するのはコマンドを実行したバス側の shell だけ**(`get` はどちらでも最新値が見えるのに)。`dbus-run-session` は呼ぶたびに別の session バスを作る(別の `DBUS_SESSION_BUS_ADDRESS`)ため、dconf の読み/書きで経路が分かれることに起因する。
  - **保存**は共有ファイル `~/.config/dconf/user`(gvdb)1 つ。`gsettings get` は毎回新規プロセスがこれを直接 mmap で読むので、バス非依存で最新値が見える(両方で一致)。
  - **変更通知**は session バス経由。dconf サービス `ca.desrt.dconf` は session バス activated で、`gsettings set` は自分のバスの dconf-service にだけ `Notify` を出す。常駐 gnome-shell はこの `Notify` を受けて初めて `changed::` を発火する → **同一バスの shell だけ点滅**。入れ子 shell のプロセス内キャッシュは通知が来ず古いまま。
  - ホストのターミナルで実行→ホスト画面、devkit のターミナルで実行→devkit 画面、が正常。

## 操作

```sh
gnome-extensions list                         # corner-blink@local; ログアウト→ログイン後に表示される
gnome-extensions info    corner-blink@local   # 状態確認
gnome-extensions disable corner-blink@local   # 停止
gnome-extensions enable  corner-blink@local   # 開始
```

## 設定

GSettings で設定する。`extension.js` の再評価 (ログアウト) は不要で、変更は**即座に反映**される (設定変更を監視して点を作り直す)。

| キー | 意味 | 既定 | 範囲 |
|------|------|------|------|
| `size` | 点のサイズ (px) | `16` | 1–512 |
| `flash-color` | 点滅色 (CSS color) | `'red'` | — |
| `flash-interval` | 点滅間隔 (ms) | `200` | 50–10000 |
| `flash-duration` | 点滅の総時間 (ms); 0 で無効 | `800` | 0–60000 |
| `flash-trigger` | 別の値に書き換えると一度点滅 | `0` | 0– |
| `indicator-color` | 右下隅の常時表示色 (CSS color); `''` で消灯 | `''` | — |

flash は全モニタの四隅、indicator は全モニタの右下隅のみに表示する。

### GUI

```sh
gnome-extensions prefs corner-blink@local
```

### CLI

```sh
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink size 24
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink flash-interval 300
gsettings --schemadir ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas set org.gnome.shell.extensions.corner-blink flash-color 'lime'
# https://developer.mozilla.org/ja/docs/Web/CSS/Reference/Values/named-color
# https://www.w3.org/TR/css-color-4/#named-colors
```

### スキーマのコンパイル

`schemas/*.gschema.xml` を変更したら再コンパイルする (生成物 `gschemas.compiled` が必要)。

```sh
glib-compile-schemas ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas/
```

> 注: 設定値の変更は即反映されるが、`extension.js` / `prefs.js` / スキーマ定義そのものの変更は従来どおりログアウト→ログイン (Wayland) が必要。

## 環境

GNOME Shell 50 / Wayland で確認。
