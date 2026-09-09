# ubuntu-gnome-desktop-misc

Ubuntu の GNOME Shell (Wayland) 向けに書いた自作の拡張とスクリプト。

| ディレクトリ / ファイル | 内容 |
|---|---|
| [`corner-blink@local/`](corner-blink@local/) | 画面四隅に点を点滅表示する GNOME Shell 拡張。外部プロセスから GSettings 経由で一度だけ点滅させたり、右下隅に常時表示の点を出したりできる。ロック画面でも動く |
| [`xremap-app-activate@local/`](xremap-app-activate@local/) | application ID や window の stable sequence を指定して window を activate する D-Bus メソッドを GNOME Shell 内から提供する拡張。focused window のモニタ名も取得できる |
| `agent_workspace_speak.py` | Codex / Claude Code の hook から使い、タスクを送信した workspace の番号を完了時に読み上げる |
| `agent_workspace_activate.py` | プロンプト待ちの Tilix terminal のうち、待ち時間が最も短いものへ切り替える。連続実行で次の候補へ回る |
| [`workspace_title.py`](workspace_title.md) / `bin/workspace-title` | Overview の各サムネイルの下に cwd と agent の要約を表示。`workspace-title.fish` で対話 fish と連携 |

各コンポーネントの詳細は、それぞれの `README.md` と `agent_workspace_*.md` を参照。

## 拡張のインストール

UUID 名で `~/.local/share/gnome-shell/extensions/` に置く。symlink でよい。

```sh
ln -s "$PWD/corner-blink@local" ~/.local/share/gnome-shell/extensions/corner-blink@local
ln -s "$PWD/xremap-app-activate@local" ~/.local/share/gnome-shell/extensions/xremap-app-activate@local
glib-compile-schemas ~/.local/share/gnome-shell/extensions/corner-blink@local/schemas/
```

Wayland では、新規のローカル拡張を実行中の gnome-shell へ読み込ませる方法がない。一度ログアウト→ログインしてから有効化する。

```sh
gnome-extensions enable corner-blink@local
gnome-extensions enable xremap-app-activate@local
```

`extension.js` を編集したときも、反映にはログアウト→ログインが必要。再ログインせずに試す方法 (`dbus-run-session` + 入れ子の gnome-shell) は [`corner-blink@local/README.md`](corner-blink@local/README.md) に書いた。

## 環境

GNOME Shell 50 / Wayland (Ubuntu) で使っている。`metadata.json` の `shell-version` もこれに合わせてある。

## 依存

- `agent_workspace_speak.py` … `spd-say` (speech-dispatcher)、`xprop`。`notify` では `pw-play` (PipeWire) も使う。workspace の追跡は Tilix の window を前提にしている
- `agent_workspace_activate.py` … `gdbus`、`xremap-app-activate@local`、`pw-play` (PipeWire)
- hook を sandbox 越しに実行する場合は sbx を使う: https://github.com/wataash/sbx-bwrap-wrapper 。必須ではなく、`python3 agent_workspace_speak.py remember` のように直接実行してもよい

## ライセンス

Apache-2.0 ([LICENSE](LICENSE))
