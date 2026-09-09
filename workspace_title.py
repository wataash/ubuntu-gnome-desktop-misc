#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 Wataru Ashihara <wataash0607@gmail.com>
# SPDX-License-Identifier: Apache-2.0
"""Publish terminal titles without activating a window or accessing D-Bus."""
import argparse
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

logger = logging.getLogger(__name__)
logger.addHandler(logging.StreamHandler())


def read_json(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def process_identity(pid):
    stat = Path(f'/proc/{pid}/stat').read_text()
    fields = stat.rsplit(')', 1)[1].split()
    return {'pid': pid, 'start': fields[19]}, int(fields[1])


def summary_identity(args):
    explicit = getattr(args, 'agent_id', None)
    identifier = explicit or os.environ.get('CODEX_THREAD_ID')
    pid = os.getppid()
    for _ in range(32):
        try:
            owner, parent = process_identity(pid)
            name = Path(f'/proc/{pid}/comm').read_text().strip().lower()
            if name in ('codex', 'claude'):
                return identifier or f'{name}:{pid}:{owner["start"]}', owner
            if parent <= 1 or parent == pid:
                break
            pid = parent
        except OSError:
            break
    # The thread ID survives sandboxes that hide the host process tree.
    if identifier:
        root = Path(os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}')) / 'agent-workspaces'
        state = read_json(root / hashlib.sha256(identifier.encode()).hexdigest())
        try:
            stat = state['agent_process_stat']
            owner = {'pid': int(stat.split(' ', 1)[0]), 'start': stat.rsplit(')', 1)[1].split()[19]}
            return identifier, owner
        except (KeyError, ValueError, IndexError, TypeError):
            pass
    return identifier or 'manual', {}


def publish(args):
    terminal = str(uuid.UUID(args.terminal))
    root = Path(os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}')) / 'agent-workspaces'
    shell = read_json(root / 'window-state.json')
    generation = shell.get('shell_session')
    if not generation:
        raise ValueError('タイトル対応の GNOME 拡張が未起動です。更新後に再ログインしてください。')
    directory = root / 'titles'
    if args.dry_run:
        print(json.dumps({'directory': str(directory), 'terminal': terminal, 'action': args.action,
                          'text': args.text, 'cwd': args.cwd}, ensure_ascii=False))
        return 0
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / f'{terminal}.json'
    # A prompt and an agent can update the same terminal concurrently.
    with (directory / f'{terminal}.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = read_json(path)
        if record.get('shell_session') != generation:
            record = {}
        if args.action == 'register':
            window = shell.get('focused')
            if type(window) is not int or str(window) not in shell.get('windows', {}):
                raise ValueError('フォーカス中の Tilix がありません。Tilix 内で実行してください。')
            record.update(window=window, shell_session=generation)
        elif str(record.get('window')) not in shell.get('windows', {}):
            raise ValueError('この terminal は未登録です。対話 fish で workspace-title register を実行してください。')
        old = json.dumps(record, sort_keys=True)
        shells = record.setdefault('shells', {})
        summaries = record.setdefault('summaries', {})
        if args.action in ('register', 'cwd'):
            pid = args.shell_pid or os.getppid()
            owner, _ = process_identity(pid)
            shells[f'{pid}:{owner["start"]}'] = dict(cwd=args.cwd, **owner)
        elif args.action == 'set':
            text = ' '.join(args.text.split())
            if not text or len(text) > 160:
                raise ValueError('タイトルは空白以外の 1〜160 文字で指定してください。')
            identifier, owner = summary_identity(args)
            summaries[identifier] = dict(summaries.get(identifier, {}), text=text, updated=time.time_ns(), **owner)
        elif args.action == 'clear':
            identifier, _ = summary_identity(args)
            summaries.pop(identifier, None)
        if args.action != 'register' and json.dumps(record, sort_keys=True) == old:
            return 0
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix='.title-', delete=False) as output:
            temporary = Path(output.name)
            try:
                json.dump(record, output, ensure_ascii=False)
                output.write('\n')
                output.close()
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
    return 0


def main():
    parser = argparse.ArgumentParser(formatter_class=argparse.ArgumentDefaultsHelpFormatter,
                                     epilog='set/clear never infer the target from the currently focused window.')
    parser.add_argument('-q', '--quiet', action='count', default=0)
    parser.add_argument('-n', '--dry_run', '--dry-run', dest='dry_run', action='store_true')
    parser.add_argument('--terminal', default=os.environ.get('TILIX_ID', ''), help='Tilix terminal UUID')
    parser.add_argument('--shell-pid', type=int, help='host shell PID (register/cwd)')
    parser.add_argument('--agent-id', help='stable summary owner ID; normally detected from the parent agent')
    parser.add_argument('--cwd', default=os.getcwd())
    parser.add_argument('action', choices=('register', 'cwd', 'set', 'clear'))
    parser.add_argument('text', nargs='?', default='')
    args = parser.parse_args()
    logger.setLevel(logging.ERROR if args.quiet else logging.INFO)
    try:
        return publish(args)
    except (OSError, ValueError) as error:
        if not args.quiet:
            logger.error('%s', error)
        return 1


if __name__ == '__main__':
    sys.exit(main())
