#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 Wataru Ashihara <wataash0607@gmail.com>
# SPDX-License-Identifier: Apache-2.0
epilog = r"""
agent_workspace_activate.py -h
agent_workspace_activate.py -n
pytest -v ~/src/ubuntu-gnome-desktop-misc/agent_workspace_activate.py  # @pl
"""[1:]

import argparse
import json
import logging
import os
from pathlib import Path
import shlex
import subprocess
import time
from typing import Any


logger = logging.getLogger(__name__)
logger.addHandler(logging.StreamHandler())

DESKTOP_ID = "com.gexperts.Tilix.desktop"
DBUS_DESTINATION = "org.gnome.Shell"
DBUS_OBJECT_PATH = "/com/wataash/XremapAppActivate"
DBUS_INTERFACE = "com.wataash.XremapAppActivate"
CYCLE_TIMEOUT_NS = 3_000_000_000
Target = tuple[int, int | None]


def runtime_dir() -> Path:
    return Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))


def read_target(path: Path) -> tuple[Target, bool] | None:
    try:
        value: Any = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(value, dict) or type(value.get("waiting")) is not bool:
        return None
    workspace = value.get("workspace")
    window = value.get("window")
    if type(workspace) is not int or workspace <= 0:
        return None
    return (workspace, window if type(window) is int and window > 0 else None), value["waiting"]


def waiting_targets(state_dir: Path) -> list[Target]:
    entries: list[tuple[int, str, Target, bool]] = []
    try:
        paths = list(state_dir.iterdir())
    except OSError:
        return []
    for path in paths:
        if len(path.name) != 64 or any(character not in "0123456789abcdef" for character in path.name):
            continue
        state = read_target(path)
        if state is None:
            continue
        target, waiting = state
        try:
            modified = path.stat().st_mtime_ns
        except OSError:
            continue
        entries.append((modified, path.name, target, waiting))

    result: list[Target] = []
    seen: set[tuple[str, int]] = set()
    for _modified, _name, target, waiting in sorted(entries, reverse=True):
        workspace, window = target
        key = ("window", window) if window is not None else ("workspace", workspace)
        if key not in seen:
            seen.add(key)
            if waiting:
                result.append(target)
    return result


def target_keys(targets: list[Target]) -> list[str]:
    return [f"window:{window}" if window is not None else f"workspace:{workspace}" for workspace, window in targets]


def cycle_index(keys: list[str], cycle_state: Any, now_ns: int) -> int:
    if not isinstance(cycle_state, dict):
        return 0
    previous_keys = cycle_state.get("targets")
    previous_index = cycle_state.get("index")
    previous_time = cycle_state.get("time_ns")
    if (
        previous_keys != keys
        or not isinstance(previous_index, int)
        or not isinstance(previous_time, int)
        or not 0 <= now_ns - previous_time <= CYCLE_TIMEOUT_NS
    ):
        return 0
    return (previous_index + 1) % len(keys)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def write_cycle_state(path: Path, keys: list[str], index: int, now_ns: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"targets": keys, "index": index, "time_ns": now_ns}) + "\n")


def activate(target: Target, *, dry_run: bool) -> bool:
    workspace, window = target
    method = "ActivateWindow" if window is not None else "ActivateOnWorkspace"
    arguments = [str(window)] if window is not None else [DESKTOP_ID, str(workspace - 1)]
    command = [
        "/bin/gdbus",
        "call",
        "--session",
        "--dest",
        DBUS_DESTINATION,
        "--object-path",
        DBUS_OBJECT_PATH,
        "--method",
        f"{DBUS_INTERFACE}.{method}",
        *arguments,
    ]
    rendered = shlex.join(command)
    logger.info("run: %s", rendered)
    if dry_run:
        print(rendered)
        return True
    try:
        completed = subprocess.run(command, check=False, stdout=subprocess.PIPE, text=True)
    except OSError as error:
        logger.error("could not run %s: %s", rendered, error)
        return False
    return completed.returncode == 0 and completed.stdout.strip() == "(true,)"


def main() -> int:
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=epilog,
        description="Activate the Tilix workspace whose Codex/Claude prompt has waited shortest.",
    )
    parser.add_argument("-n", "--dry-run", "--dry_run", action="store_true")
    parser.add_argument("-v", "--verbose", action="count", default=0)
    args = parser.parse_args()
    logger.setLevel(logging.INFO if args.verbose else logging.WARNING)

    base = runtime_dir()
    targets = waiting_targets(base / "agent-workspaces")
    if not targets:
        return 0
    keys = target_keys(targets)
    cycle_path = base / "kana-agent-waiting.json"
    now_ns = time.time_ns()
    start_index = cycle_index(keys, read_json(cycle_path), now_ns)
    for offset in range(len(targets)):
        index = (start_index + offset) % len(targets)
        if not activate(targets[index], dry_run=args.dry_run):
            continue
        if not args.dry_run:
            try:
                write_cycle_state(cycle_path, keys, index, now_ns)
            except OSError as error:
                logger.error("could not save cycle state: %s", error)
        return 0
    return 1


def test_waiting_targets(tmp_path: Path) -> None:
    old = tmp_path / ("1" * 64)
    new = tmp_path / ("2" * 64)
    same_workspace = tmp_path / ("3" * 64)
    running = tmp_path / ("4" * 64)
    legacy = tmp_path / ("5" * 64)
    old.write_text('{"workspace":3,"waiting":true,"window":30}\n')
    new.write_text('{"workspace":2,"waiting":true,"window":20}\n')
    same_workspace.write_text('{"workspace":4,"waiting":true,"window":30}\n')
    running.write_text('{"workspace":1,"waiting":false}\n')
    legacy.write_text("4\n")
    os.utime(old, ns=(10, 10))
    os.utime(new, ns=(20, 20))
    os.utime(same_workspace, ns=(30, 30))
    assert waiting_targets(tmp_path) == [(4, 30), (2, 20)]


def test_latest_window_state_controls_waiting(tmp_path: Path) -> None:
    old = tmp_path / ("1" * 64)
    latest = tmp_path / ("2" * 64)
    other = tmp_path / ("3" * 64)
    old.write_text('{"workspace":2,"waiting":true,"window":20}\n')
    latest.write_text('{"workspace":3,"waiting":false,"window":20}\n')
    other.write_text('{"workspace":3,"waiting":true,"window":30}\n')
    os.utime(old, ns=(10, 10))
    os.utime(latest, ns=(30, 30))
    os.utime(other, ns=(20, 20))
    assert waiting_targets(tmp_path) == [(3, 30)]

    latest.write_text('{"workspace":3,"waiting":true,"window":20}\n')
    os.utime(latest, ns=(40, 40))
    assert waiting_targets(tmp_path) == [(3, 20), (3, 30)]


def test_cycle_index() -> None:
    keys = ["window:3", "window:2", "workspace:5"]
    state = {"targets": keys, "index": 0, "time_ns": 10}
    assert cycle_index(keys, state, 11) == 1
    assert cycle_index(keys, state, 10 + CYCLE_TIMEOUT_NS + 1) == 0
    assert cycle_index(["window:2", "window:3", "workspace:5"], state, 11) == 0


if __name__ == "__main__":
    raise SystemExit(main())
