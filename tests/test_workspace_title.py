import argparse
import importlib.util
import json
import os
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('workspace_title', Path(__file__).parents[1] / 'workspace_title.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
UUID = '00000000-0000-4000-8000-000000000001'


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setenv('XDG_RUNTIME_DIR', str(tmp_path))
    root = tmp_path / 'agent-workspaces'
    root.mkdir()
    shell = root / 'window-state.json'
    shell.write_text(json.dumps(dict(shell_session='session1', focused=42, windows={'42': 1, '99': 2})))
    return root, shell


def call(action, text='', **kwargs):
    values = dict(action=action, terminal=UUID, dry_run=False, cwd='/src/example',
                  text=text, shell_pid=os.getpid(), agent_id='test')
    values.update(kwargs)
    return module.publish(argparse.Namespace(**values))


def record(root):
    return json.loads((root / 'titles' / f'{UUID}.json').read_text())


def test_background_update_keeps_target_and_summary(state):
    root, shell = state
    call('register')
    shell.write_text(json.dumps(dict(shell_session='session1', focused=99, windows={'42': 3, '99': 2})))
    call('set', '認証処理を修正')
    call('cwd')
    assert record(root)['window'] == 42
    assert record(root)['summaries']['test']['text'] == '認証処理を修正'
    call('clear')
    assert 'test' not in record(root)['summaries']
    assert [entry['cwd'] for entry in record(root)['shells'].values()] == ['/src/example']


def test_unregistered_or_new_shell_cannot_update_focused_window(state):
    root, shell = state
    with pytest.raises(ValueError):
        call('set', 'wrong target')
    call('register')
    shell.write_text(json.dumps(dict(shell_session='session2', focused=99, windows={'42': 1, '99': 2})))
    with pytest.raises(ValueError):
        call('set', 'wrong generation')


def test_reregister_preserves_title_and_tracks_detached_terminal(state):
    root, shell = state
    call('register')
    call('set', '保持する')
    shell.write_text(json.dumps(dict(shell_session='session1', focused=99, windows={'99': 2})))
    call('register')
    assert record(root)['window'] == 99
    assert record(root)['summaries']['test']['text'] == '保持する'


def test_invalid_title_and_no_focus(state):
    root, shell = state
    call('register')
    for text in ('   ', 'a' * 161):
        with pytest.raises(ValueError):
            call('set', text)
    shell.write_text(json.dumps(dict(shell_session='session1', focused=None, windows={'42': 1})))
    with pytest.raises(ValueError):
        call('register')


def test_all_shells_and_agents_are_preserved(state, monkeypatch):
    root, _ = state
    monkeypatch.setattr(module, 'process_identity', lambda pid: ({'pid': pid, 'start': str(pid)}, 1))
    call('register', shell_pid=101, cwd='/home/test')
    call('register', shell_pid=102, cwd='/var/log')
    call('set', 'fooを実装', agent_id='codex-a')
    call('set', 'barをリファクタリング', agent_id='claude-b')
    call('cwd', shell_pid=101, cwd='/home/test/src')
    data = record(root)
    assert {entry['cwd'] for entry in data['shells'].values()} == {'/home/test/src', '/var/log'}
    assert {entry['text'] for entry in data['summaries'].values()} == {'fooを実装', 'barをリファクタリング'}
    call('set', 'fooのテスト', agent_id='codex-a')
    call('clear', agent_id='claude-b')
    assert list(record(root)['summaries']) == ['codex-a']
    assert record(root)['summaries']['codex-a']['text'] == 'fooのテスト'


def test_agent_identity_is_stable_with_or_without_visible_parent(monkeypatch):
    monkeypatch.setenv('CODEX_THREAD_ID', 'thread-123')
    monkeypatch.setattr(module, 'process_identity', lambda pid: ({'pid': pid, 'start': '123'}, 1))
    monkeypatch.setattr(module.Path, 'read_text', lambda self: 'codex')
    key, owner = module.summary_identity(argparse.Namespace(agent_id=None))
    assert key == 'thread-123'
    assert owner['start'] == '123'
    def hidden(pid):
        raise FileNotFoundError()
    monkeypatch.setattr(module, 'process_identity', hidden)
    key, owner = module.summary_identity(argparse.Namespace(agent_id=None))
    assert key == 'thread-123'
    assert owner == {}
