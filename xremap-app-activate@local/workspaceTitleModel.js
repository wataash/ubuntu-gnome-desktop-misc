// SPDX-License-Identifier: Apache-2.0
export function displayDirectory(path, home) {
    if (typeof path !== 'string' || !path.startsWith('/'))
        return '';
    path = path.replace(/\/+$/, '') || '/';
    home = home?.replace(/\/+$/, '');
    if (home && (path === home || path.startsWith(`${home}/`)))
        path = `~${path.slice(home.length)}`;
    return path.endsWith('/') ? path : `${path}/`;
}

// Records are filtered for process liveness by the Shell adapter.
export function selectTitle(records, windowIds, index, names = [], home = '') {
    const candidates = records.filter(record => windowIds.includes(record.window));
    const summaries = new Map();
    const directories = new Set();
    for (const record of candidates) {
        for (const [id, summary] of Object.entries(record.summaries ?? {})) {
            // Manual titles belong to terminals; agent IDs span terminal moves.
            const key = id === 'manual' ? `${record.terminal ?? record.window}:manual` : id;
            if (typeof summary.text === 'string' && summary.text &&
                (!summaries.has(key) || (summary.updated ?? 0) > (summaries.get(key).updated ?? 0)))
                summaries.set(key, summary);
        }
        for (const shell of Object.values(record.shells ?? {})) {
            const cwd = displayDirectory(shell.cwd, home);
            if (cwd)
                directories.add(cwd);
        }
    }
    const lines = [...summaries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, summary]) => summary.text);
    lines.push(...[...directories].sort((a, b) => Number(b === '~/') - Number(a === '~/') || (a < b ? -1 : a > b ? 1 : 0)));
    if (!lines.length && names[index])
        lines.push(names[index]);
    return {heading: `${index + 1}`, text: lines.join('\n')};
}
