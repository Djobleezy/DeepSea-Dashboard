const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filePath = path.join(__dirname, '../../static/js/main.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('function formatDuration('));
let end = start;
while (end < lines.length && !lines[end].startsWith('}')) {
    end++;
}
const snippet = lines.slice(start, end + 1).join('\n');

const context = {};
vm.createContext(context);
vm.runInContext(snippet, context);

assert.strictEqual(context.formatDuration(-5), '0m 00s');
console.log('formatDuration negative input test passed');
