const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupBasicDOM } = require('./test_utils');

setupBasicDOM();

const filePath = path.join(__dirname, '../../static/js/main.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('function calculateBlockProbability')); // start of snippet
let end = start;
while (end < lines.length && !lines[end].includes('function calculatePoolLuck')) { end++; }
const snippet = lines.slice(start, end).join('\n');

const context = { console, window: global.window };
context.normalizeHashrate = (v) => v;
context.numberWithCommas = (x) => Number(x).toLocaleString();
vm.createContext(context);
vm.runInContext(snippet, context);

assert.strictEqual(context.calculateBlockProbability(100, 'th/s', 100), '1 : 1,000,000');
assert.strictEqual(context.calculateBlockProbability(0, 'th/s', 100), 'N/A');
assert.strictEqual(context.calculateBlockTime(100, 'th/s', 100), '19 years');
assert.strictEqual(context.formatTimeRemaining(0), 'N/A');
assert.strictEqual(context.formatTimeRemaining(600), '10 minutes');
assert.strictEqual(context.formatTimeRemaining(3153600001), 'Never (statistically)');

console.log('block probability and time calculation tests passed');
