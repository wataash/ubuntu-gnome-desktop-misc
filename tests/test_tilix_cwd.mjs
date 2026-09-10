import assert from 'node:assert/strict';
import {parseTilixCwd} from '../xremap-app-activate@local/tilixCwd.js';

const title = (path, host = 'local') => `Tilix [code-cwd:${host}] ${path} [code-cwd-end]`;
for (const path of ['/', '/tmp/a b/日本語', '/tmp/$(touch pwned); "quote" & <tag>', '/tmp/[code-cwd-end] ', '/tmp/a\\b'])
    assert.equal(parseTilixCwd(title(path), 'local'), path);
assert.equal(parseTilixCwd(title('/tmp', ''), 'local'), '/tmp');
for (const value of [null, '', '/tmp', title('relative'), title('/tmp', 'remote'), title('/tmp\nnext'), title('/tmp\0x'), title('/tmp/${directory}'), title('/tmp').slice(0, -1), title('/tmp') + '\n'])
    assert.throws(() => parseTilixCwd(value, 'local'));
console.log('PASS: title parsing, spaces, Unicode, shell metacharacters, invalid/remote/truncated titles');
