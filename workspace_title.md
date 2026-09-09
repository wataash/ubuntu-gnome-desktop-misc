# ワークスペースのタイトル

Super キーの Overview で、各サムネイルの下に次を改行区切りで表示する。

1. その workspace にいる全 agent の要約（同じ文章でも別 agent なら残す）
2. 全 shell の cwd（重複を除く）

ホームディレクトリ配下は `~/` 表記、ディレクトリ末尾は `/` とする。
長い要約・パスは折り返し、行数に合わせて表示領域を広げる。文字部分のホバーでも全文を表示する。
サムネイルは幅210px相当を目安に拡大し、数が多い場合は画面幅に合わせて縮める。
GNOME Shell 50 の `xremap-app-activate@local/` に実装。

```text
fooを実装
barをリファクタリング
~/
/var/log/
~/src/ubuntu-gnome-desktop-misc/dir/dir/dir/
```

## 設定と使い方

既存の拡張は本リポジトリへの symlink のため、更新後にログアウト・ログインする。
対話 fish の `config.fish` 内で次を読み込む。別ホストにリポジトリがない場合は何もしない。

```fish
# 新しい fish に cwd 通知と workspace-title コマンドを追加
test -f ~/src/ubuntu-gnome-desktop-misc/workspace-title.fish && source ~/src/ubuntu-gnome-desktop-misc/workspace-title.fish
# 既存の fish には上の source 行を実行する。最初の対話コマンドで terminal を登録する。
workspace-title set 'ログイン処理を修正'
workspace-title clear  # 自分の agent の要約だけを消す
```

CLI の `set` / `clear` は Bash でも同じ。CLI を直接呼ぶ場合は
`~/src/ubuntu-gnome-desktop-misc/bin/workspace-title set 'ログイン処理を修正'`。
`-n` / `--dry-run` では書き込み予定を表示する。

agent は作業開始時と作業内容が変わったときに短い要約を `set` する。
`CODEX_THREAD_ID`、または親プロセスの codex/claude の PID・起動時刻を agent の識別子として使う。
同じ terminal 内でも別 agent の要約を上書きしない。識別子は `--agent-id SESSION_ID` でも指定できる。
PID 名前空間で親 agent が見えない場合は、セッション固有の固定 ID を明示する。
`clear` も同じ識別子で呼ぶ。agent を識別できない手動実行は terminal ごとの `manual` 枠を使う。

コマンドは `TILIX_ID` を継承したローカル terminal で使用する。
未登録・拡張未反映ならエラー終了し、フォーカス中の別 window へは書き込まない。
**agent から register は呼ばない**。これは対話ユーザーが入力した時点のフォーカスを登録するコマンド。

## 集約と追跡

- fish の `fish_preexec` が terminal UUID → フォーカス中の Tilix window を登録する。
  `fish_prompt` と `PWD` の変更時に shell の PID・起動時刻・cwd を記録する。
  バックグラウンド処理完了時のプロンプトで別 window に再登録しない。
- 同じ terminal の入れ子の fish も個別に記録する。別 pane／window の記録も workspace 内で集約する。
- 要約は agent ID 順、cwd は `~/` を先頭にした辞書順で表示。cwd の末尾 `/` の有無は同一視する。
- window ごと別 workspace に移動した場合は追従する。workspace の挿入・削除・並べ替えでも番号を固定しない。
- terminal を別 window に分離・移動した場合は、その terminal で次に対話コマンドを実行して再登録する。それまでは元の window の対応が残る。
- PID・起動時刻が一致しない shell／agent は個別に除外する。他の shell／agent の記録は残す。
  Overview 表示中は2秒ごとにも生存確認する。PID が取得できない明示 ID／手動の要約は `clear` まで残る。
- 情報がない workspace では GNOME の `workspace-names` を使い、それもなければ番号だけを表示する。
- 拡張の再有効化／再ログイン後は次の対話コマンドで再登録する。
- 初回 source／新しい terminal を開いただけでは未登録。最初にコマンドを実行してから cwd が表示される。
  自動連携はこの fish 設定を読み込んだ shell が対象。他の shell は `--shell-pid PID register` と `--shell-pid PID cwd` の通知が必要。
- SSH 接続先の fish では自動連携を登録しない。同期入力で複数 window に同時実行する場合のフォーカス登録には対応しない。

## 状態と sandbox

`$XDG_RUNTIME_DIR/agent-workspaces/window-state.json` の `shell_session` と window ID を利用。
`titles/<TILIX_ID>.json` は terminal 単位で、`shells` に各 shell の `cwd/pid/start`、
`summaries` に各 agent の `text/updated/pid/start` を保存する。親が見えない場合、
agent hook のセッション ID を SHA-256 化した状態ファイルの `agent_process_stat` からも PID・起動時刻を取得する。
terminal 単位の flock と atomic rename で、複数 shell／agent の同時更新を保護する。
GNOME 拡張はファイル変更を監視し、80ms のまとめ処理でラベルを更新する。
状態はローカルの runtime directory のみで、Git やホーム設定の同期には含まれない。

sandbox 内からの更新は `TILIX_ID`、`XDG_RUNTIME_DIR` と agent 識別子の引き継ぎ、
window-state と（生存確認用）agent hook 状態ファイルの読み取り、titles/ の書き込みが必要。
D-Bus、Wayland ソケット、ネットワーク接続は不要。sbx で限定した権限を渡す例（Fish／Bash 共通）:

```sh
sbx -r /home/wsh/src/ubuntu-gnome-desktop-misc/ -r "$XDG_RUNTIME_DIR/agent-workspaces/" -w "$XDG_RUNTIME_DIR/agent-workspaces/titles/" -e XDG_RUNTIME_DIR -e TILIX_ID -e CODEX_THREAD_ID -- /usr/bin/python3 /home/wsh/src/ubuntu-gnome-desktop-misc/workspace_title.py set 'ログイン処理を修正'
```

## 確認

```sh
/usr/bin/python3 -m pytest -q -p no:cacheprovider tests/test_workspace_title.py
node tests/workspace_title_model.mjs
node tests/workspace_title_layout.mjs
fish --no-config --no-execute workspace-title.fish
```

GNOME Shell 50.1 の `--wayland --devkit --no-x11` を別 D-Bus と `/tmp/` の専用 HOME・設定・runtime directory で起動して確認する。
専用 runtime directory を使う場合、devkit の映像表示にはホストの `pipewire-0` ソケットへの参照も必要。
[入れ子の GNOME Shell](corner-blink@local/README.md#ログアウトせずにテストする-dbus-run-session--devkit) も参照。
本体セッションの再読み込みには再ログインが必要。

2026-09-09: devkit 内の Tilix に要約2件、cwd3種類と重複 cwd、終了済み PID のサンプルを紐付け、
全要約・重複なしの cwd・長いパスの折り返し・終了済みプロセスの除外を確認した。
CLI の複数 shell／agent による更新・個別 clear は自動テストでも検証する。

2026-09-10: Overview のレイアウト計算中の actor 変更を除去。文字の高さは Pango layout のコピーで計測し、
ラベルの作成・本文更新はサムネイルの追加時と `refresh()` で行う。
Clutter がキャッシュする preferred height は allocation 中も同じ値を返し、空のサムネイルでは高さを要求しない。
4K を含む3モニター・Ubuntu Dock 併用の devkit で、Overview の表示・非表示を繰り返し、
12個のサムネイルの正の寸法・ラベル全文の収まりを確認した。Tilix を開いた状態でも割り当てエラーが出ないことを確認した。
