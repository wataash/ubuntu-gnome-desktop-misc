import assert from 'node:assert/strict';
import {selectTitle, displayDirectory} from '../xremap-app-activate@local/workspaceTitleModel.js';
const records = [
    {window: 42, terminal: 'one', shells: {a: {cwd: '/home/test/'}, b: {cwd: '/var/log'}}, summaries: {'codex-a': {text: 'fooを実装'}}},
    {window: 42, terminal: 'two', shells: {a: {cwd: '/home/test'}, b: {cwd: '/home/test/src/ubuntu-gnome-desktop-misc/dir/dir/dir/'}}, summaries: {'claude-b': {text: 'barをリファクタリング'}}},
    {window: 99, shells: {a: {cwd: '/elsewhere'}}, summaries: {'other': {text: '別のworkspace'}}},
];
const title = selectTitle(records, [42], 0, [], '/home/test');
assert.equal(title.heading, '1');
assert.deepEqual(title.text.split('\n'), ['barをリファクタリング', 'fooを実装', '~/', '/var/log/', '~/src/ubuntu-gnome-desktop-misc/dir/dir/dir/']);
assert.equal(selectTitle(records, [42], 4, [], '/home/test').text, title.text);
assert.equal(selectTitle(records, [], 2, ['', '', '調査']).text, '調査');
assert.equal(selectTitle(records, [], 2).text, '');
assert.equal(displayDirectory('/', '/home/test'), '/');
assert.equal(displayDirectory('/home/test-other', '/home/test'), '/home/test-other/');
const identical = [{window: 1, summaries: {a: {text: '同じ要約'}, b: {text: '同じ要約'}}}];
assert.equal(selectTitle(identical, [1], 0).text, '同じ要約\n同じ要約');
console.log('workspace aggregate titles: passed');
