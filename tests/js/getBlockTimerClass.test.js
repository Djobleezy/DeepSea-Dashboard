const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filePath = path.join(__dirname, '../../static/js/main.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('function getBlockTimerClass'));
let end = start;
while (end < lines.length && !lines[end].startsWith('}')) {
    end++;
}
const snippet = lines.slice(start, end + 1).join('\n');

const context = {};
vm.createContext(context);
vm.runInContext(snippet, context);

assert.strictEqual(context.getBlockTimerClass(0), 'very-lucky');
assert.strictEqual(context.getBlockTimerClass(8 * 60 - 1), 'very-lucky');
assert.strictEqual(context.getBlockTimerClass(8 * 60), 'lucky');
assert.strictEqual(context.getBlockTimerClass(10 * 60 - 1), 'lucky');
assert.strictEqual(context.getBlockTimerClass(10 * 60), 'normal-luck');
assert.strictEqual(context.getBlockTimerClass(12 * 60), 'normal-luck');
assert.strictEqual(context.getBlockTimerClass(12 * 60 + 1), 'unlucky');

console.log('getBlockTimerClass tests passed');
