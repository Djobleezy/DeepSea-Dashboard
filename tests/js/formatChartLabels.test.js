const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { setupBasicDOM, setupJqueryStub } = require('./test_utils');

setupBasicDOM();
setupJqueryStub();

const code = fs.readFileSync(__dirname + '/../../static/js/main.js', 'utf8');
vm.runInThisContext(code);

assert.strictEqual(typeof formatChartLabels, 'function');

const tz = 'UTC';
const start = new Date('2024-01-01T00:00:00Z');
const longSpan = Array.from({ length: 1500 }, (_, i) => new Date(start.getTime() + i * 60000));
const longInfo = formatChartLabels(longSpan, tz);
assert.ok(longInfo.useExtendedLabels, 'useExtendedLabels should be true for > 1 day');
assert.ok(longInfo.labels[0].includes('\n'), 'extended labels contain newline');

const shortSpan = longSpan.slice(0, 60);
const shortInfo = formatChartLabels(shortSpan, tz);
assert.ok(!shortInfo.useExtendedLabels, 'useExtendedLabels should be false for short span');
assert.ok(!shortInfo.labels[0].includes('\n'), 'short labels should not contain newline');

console.log('formatChartLabels tests passed');
