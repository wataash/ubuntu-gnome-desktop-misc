// SPDX-License-Identifier: Apache-2.0

// Use the whole title, not ${title}/${sessionName}, which applications/users can change.
export const TILIX_CWD_TITLE = 'Tilix [code-cwd:${hostname}] ${directory} [code-cwd-end]';

export function parseTilixCwd(title, localHostname) {
    const match = /^Tilix \[code-cwd:([^\]\r\n]*)\] (\/[^\x00-\x1f\x7f]*) \[code-cwd-end\]$/.exec(title ?? '');
    if (!match || match[0] !== title || (match[1] !== '' && match[1] !== localHostname))
        throw new Error('Tilix の cwd タイトルがないか、ローカルのディレクトリではありません。');
    if (match[2].includes('${'))
        throw new Error('Tilix のタイトル変数を含むパスには対応していません。');
    return match[2];
}
