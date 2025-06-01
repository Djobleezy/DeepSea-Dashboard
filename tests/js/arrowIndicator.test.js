const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupBasicDOM, setupJqueryStub } = require('./test_utils');

setupBasicDOM();
setupJqueryStub();

// Provide theme and normalization stubs
global.THEME = { SHARED: { GREEN: 'green', RED: 'red' } };
global.getCurrentTheme = () => ({ SHARED: { GREEN: 'green', RED: 'red' } });
global.window.normalizeHashrate = (v) => v;

const filePath = path.join(__dirname, '../../static/js/main.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('class ArrowIndicator'));
const end = lines.findIndex((l, i) => i > start && l.includes('// Create the singleton instance'));
const snippet = lines.slice(start, end).join('\n');
const augmented = `${snippet}\nglobalThis.ArrowIndicator = ArrowIndicator;`;

const context = {
    console,
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    MutationObserver: global.MutationObserver,
    setTimeout: global.setTimeout,
    THEME,
    getCurrentTheme
};
vm.createContext(context);
vm.runInContext(augmented, context);
context.arrowIndicator = new context.ArrowIndicator();

context.arrowIndicator.updateIndicators({ pool_total_hashrate: 100, pool_total_hashrate_unit: 'th/s' });
context.arrowIndicator.updateIndicators({ pool_total_hashrate: 200, pool_total_hashrate_unit: 'th/s' });
assert.ok(context.arrowIndicator.arrowStates.pool_total_hashrate.includes('fa-angle-double-up'));

context.arrowIndicator.updateIndicators({ pool_total_hashrate: 50, pool_total_hashrate_unit: 'th/s' });
assert.ok(context.arrowIndicator.arrowStates.pool_total_hashrate.includes('fa-angle-double-down'));

console.log('ArrowIndicator updateIndicators tests passed');
