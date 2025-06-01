const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupBasicDOM } = require('./test_utils');

setupBasicDOM();

const filePath = path.join(__dirname, '../../static/js/workers.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('function normalizeHashrate'));
let end = lines.findIndex(l => l.includes('return Math.round(totalPower)'));
if (end === -1) { end = lines.length; }
const snippet = lines.slice(start, end + 2).join('\n');

const context = { console, window: global.window, workerData: { power_cost: 0.1 } };
vm.createContext(context);
vm.runInContext(snippet, context);

assert.strictEqual(context.normalizeHashrate(1, 'ph/s'), 1000);
assert.strictEqual(context.normalizeHashrate(500, 'gh/s'), 0.5);
assert.strictEqual(context.formatHashrateForDisplay(1500, 'th/s'), '1.50 PH/s');

const worker = { status: 'online', power_consumption: 1000 };
const cost = context.calculatePowerCost(worker);
assert.ok(Math.abs(cost.dailyCost - 2.4) < 0.01);
assert.ok(Math.abs(cost.monthlyCost - 72) < 0.1);

console.log('worker utilities tests passed');
