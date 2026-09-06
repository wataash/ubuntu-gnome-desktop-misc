#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 Wataru Ashihara <wataash0607@gmail.com>
# SPDX-License-Identifier: Apache-2.0

import argparse
import hashlib
import json
import logging
import os
from pathlib import Path
import pwd
import shlex
import subprocess
import sys
import tempfile
from typing import Any


logger = logging.getLogger(__name__)
logger.addHandler(logging.StreamHandler())

WORKSPACE_WORDS = (
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
)


def run_command(command: list[str], *, dry_run: bool, capture_stdout: bool = False) -> str:
    rendered = shlex.join(command)
    logger.info("run: %s", rendered)
    if dry_run:
        print(rendered)
        return ""

    try:
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE if capture_stdout else None,
            stderr=subprocess.DEVNULL if capture_stdout else None,
            text=True,
        )
    except OSError as error:
        logger.error("could not run %s: %s", rendered, error)
        return ""
    return completed.stdout if capture_stdout else ""


def parse_workspace_number(output: str) -> int | None:
    """
    Parse xprop's zero-based workspace number.

    >>> parse_workspace_number("_NET_CURRENT_DESKTOP(CARDINAL) = 1\\n")
    2
    >>> parse_workspace_number("not available") is None
    True
    """
    for line in output.splitlines():
        name, separator, value = line.partition("=")
        if separator and "_NET_CURRENT_DESKTOP" in name:
            try:
                return int(value.strip()) + 1
            except ValueError:
                return None
    return None


def workspace_number(*, dry_run: bool) -> int | None:
    output = run_command(
        ["xprop", "-root", "_NET_CURRENT_DESKTOP"],
        dry_run=dry_run,
        capture_stdout=True,
    )
    return parse_workspace_number(output)


def workspace_word(number: int) -> str:
    """
    >>> workspace_word(2)
    'two'
    >>> workspace_word(21)
    '21'
    """
    if 0 < number < len(WORKSPACE_WORDS):
        return WORKSPACE_WORDS[number]
    return str(number)


def session_id(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    for name in ("session_id", "sessionId", "thread_id", "threadId"):
        value = payload.get(name)
        if value is not None and value != "":
            return str(value)
    return None


def load_payload() -> Any:
    try:
        return json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def state_path(identifier: str | None) -> Path | None:
    if identifier is None:
        return None
    runtime_dir = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    digest = hashlib.sha256(identifier.encode()).hexdigest()
    return runtime_dir / "agent-workspaces" / digest


def read_state(path: Path | None) -> tuple[int | None, bool, int | None]:
    if path is None:
        return None, False, None
    try:
        text = path.read_text()
    except OSError:
        return None, False, None

    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        # Files made by older versions contained only the workspace number.
        try:
            number = int(text.strip())
        except ValueError:
            return None, False, None
        return (number if number > 0 else None), False, None

    if type(value) is int:
        return (value if value > 0 else None), False, None
    if not isinstance(value, dict):
        return None, False, None
    saved_number = value.get("workspace")
    waiting = value.get("waiting") is True
    saved_window = value.get("window")
    parsed_number = saved_number if type(saved_number) is int and saved_number > 0 else None
    window = saved_window if type(saved_window) is int and saved_window > 0 else None
    return parsed_number, waiting, window


def read_number(path: Path | None) -> int | None:
    return read_state(path)[0]


def write_state(path: Path, number: int, *, waiting: bool, window: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(fd, "w") as file:
            value = {"workspace": number, "waiting": waiting}
            # The hook supplies host /proc stat before entering sbx's PID namespace.
            process_stat = os.environ.get("AGENT_PROCESS_STAT")
            if process_stat:
                value["agent_process_stat"] = process_stat
            if window is not None:
                value["window"] = window
            json.dump(value, file, separators=(",", ":"))
            file.write("\n")
        temporary_path.replace(path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def test_state_round_trip(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("AGENT_PROCESS_STAT", "123 (codex) S")
    path = tmp_path / "state"
    write_state(path, 3, waiting=False, window=42)
    assert read_state(path) == (3, False, 42)
    assert json.loads(path.read_text())["agent_process_stat"] == "123 (codex) S"
    write_state(path, 3, waiting=True, window=42)
    assert read_state(path) == (3, True, 42)
    path.write_text("2\n")
    assert read_state(path) == (2, False, None)


def window_state_path() -> Path:
    runtime_dir = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    return runtime_dir / "agent-workspaces" / "window-state.json"


def window_workspace(window: int | None = None) -> tuple[int | None, int | None]:
    try:
        value = json.loads(window_state_path().read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None, None
    if not isinstance(value, dict):
        return None, None
    if window is None:
        candidate = value.get("focused")
        window = candidate if type(candidate) is int and candidate > 0 else None
    workspaces = value.get("windows")
    if window is None or not isinstance(workspaces, dict):
        return None, window
    candidate = workspaces.get(str(window))
    workspace = candidate if type(candidate) is int and candidate > 0 else None
    return workspace, window


def test_window_workspace(tmp_path: Path, monkeypatch: Any) -> None:
    state_dir = tmp_path / "agent-workspaces"
    state_dir.mkdir()
    (state_dir / "window-state.json").write_text(
        '{"focused":42,"windows":{"42":3,"71":5}}\n'
    )
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    assert window_workspace() == (3, 42)
    assert window_workspace(71) == (5, 71)
    assert window_workspace(99) == (None, 99)


def ensure_user_entry() -> None:
    try:
        pwd.getpwuid(os.getuid())
        return
    except KeyError:
        pass

    try:
        Path("/etc/passwd").write_text(
            f"sbx:x:{os.getuid()}:{os.getgid()}:Sandbox user:/work:/usr/bin/false\n"
        )
    except OSError as error:
        logger.warning("could not create the sandbox passwd entry: %s", error)


def remember(path: Path | None, *, dry_run: bool) -> None:
    number, window = window_workspace()
    if number is None:
        number = workspace_number(dry_run=dry_run)
    if path is None or dry_run:
        return
    if number is None:
        number, _waiting, saved_window = read_state(path)
        if window is None:
            window = saved_window
    if number is None:
        return
    try:
        write_state(path, number, waiting=False, window=window)
    except OSError as error:
        logger.error("could not save workspace state: %s", error)


def speak(path: Path | None, *, notify: bool, dry_run: bool) -> None:
    number, _waiting, window = read_state(path)
    moved_number, _window = window_workspace(window) if window is not None else (None, None)
    if moved_number is not None:
        number = moved_number
    if number is None:
        number = workspace_number(dry_run=dry_run)
    if number is None:
        return
    if path is not None and not dry_run:
        try:
            write_state(path, number, waiting=True, window=window)
        except OSError as error:
            logger.error("could not save workspace state: %s", error)
    if not dry_run:
        ensure_user_entry()
    if notify:
        run_command(
            ["pw-play", "/usr/share/sounds/freedesktop/stereo/bell.oga"],
            dry_run=dry_run,
        )
    run_command(
        [
            "spd-say",
            "--priority=notification",
            "--language=en",
            "--volume=-20",
            workspace_word(number),
        ],
        dry_run=dry_run,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("-n", "--dry-run", "--dry_run", action="store_true")
    parser.add_argument("-v", "--verbose", action="count", default=0)
    parser.add_argument("action", choices=("remember", "speak", "notify"))
    args = parser.parse_args()
    logger.setLevel(logging.INFO if args.verbose else logging.WARNING)
    os.umask(0o077)

    path = state_path(session_id(load_payload()))
    if args.action == "remember":
        remember(path, dry_run=args.dry_run)
    else:
        speak(path, notify=args.action == "notify", dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
