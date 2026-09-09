import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the actual injection callbacks without loading GNOME's GI modules.
const source = fs.readFileSync(process.argv[2] ?? new URL('../xremap-app-activate@local/workspaceTitles.js', import.meta.url), 'utf8');
const start = source.indexOf('        const owner = this;');
const injections = source.slice(start, source.indexOf('        this.refresh();', start));
class Box {
    constructor() { this._thumbnails = [{}]; }
    get maxThumbnailScale() { return 0.1; }
    vfunc_get_preferred_height() { return [80, 80]; }
    vfunc_get_preferred_width() { return [200, 200]; }
    vfunc_allocate() {
        this.duringAllocation = this.vfunc_get_preferred_height(200);
        this.allocationScale = this.maxThumbnailScale;
    }
}
const owner = {
    _resize() {},
    _rowHeight() { return 64; },
    _allocate() {},
    _injections: {
        overrideMethod(proto, method, makeOverride) { proto[method] = makeOverride(proto[method]); },
    },
};
new Function('ThumbnailsBox', 'Main', 'global', injections).call(owner, Box, {
    layoutManager: {getWorkAreaForMonitor: () => ({height: 1000})},
}, {stage: {height: 1000}});
const box = new Box();
assert.deepEqual(box.vfunc_get_preferred_height(200), [144, 144]);
box.vfunc_allocate({});
assert.deepEqual(box.duringAllocation, [144, 144], 'Clutter must be able to cache the same preferred height during allocation');
assert.equal(box.allocationScale, 0.1, 'labels must not enlarge the thumbnail image');
assert.equal(box.maxThumbnailScale, 0.164);
box._thumbnails = [];
assert.deepEqual(box.vfunc_get_preferred_height(200), [0, 0]);
assert.equal(box.maxThumbnailScale, 0.1);
console.log('PASS: cache-independent preferred height, image scale, empty thumbnails');

const rowMethod = source.slice(source.indexOf('    _rowHeight(box) {'), source.indexOf('    _resize(box) {'));
const measureRow = new Function('St', 'global', 'Pango', `return function ${rowMethod.trim()}`)(
    {ThemeContext: {get_for_stage: () => ({scale_factor: 1})}, Side: {TOP: 0, BOTTOM: 1}},
    {stage: {}}, {SCALE: 1024});
const measurement = {
    _measureCache: new Map(),
    _title: () => ({text: '複数行のワークスペース名'}),
    _measure: {
        set text(_) { throw Error('Do not mutate an actor while measuring its parent'); },
        clutter_text: {get_layout: () => ({copy: () => {
            return {set_text() {}, set_width() {}, get_pixel_size: () => [100, 54]};
        }})},
    },
};
const measuredBox = {
    _maxThumbnailScale: 0.1,
    _porthole: {width: 1920, height: 1080},
    _thumbnails: [{metaWorkspace: {}}],
    get_theme_node: () => ({get_vertical_padding: () => 0, get_border_width: () => 0}),
};
measureRow.call(measurement, measuredBox);
measureRow.call(measurement, measuredBox);
console.log('PASS: measurement does not invalidate actor layout');
