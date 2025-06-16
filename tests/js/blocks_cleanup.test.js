const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { setupBasicDOM, setupJqueryStub } = require('./test_utils');

setupBasicDOM();
setupJqueryStub();

let destroyed = false;
function Chart() {
    this.destroy = () => { destroyed = true; };
}

const context = {
    console,
    window: { Chart },
    Chart,
    $: global.$,
    document: global.document,
    setInterval: () => 1,
    setTimeout: () => 1,
    clearInterval: id => cleared.push(id),
    localStorage: global.localStorage,
    navigator: {},
    globalThis: {}
};
const cleared = [];
vm.createContext(context);

const code = fs.readFileSync(__dirname + '/../../static/js/blocks.js', 'utf8');
vm.runInContext(code, context);

// Create chart instance and intervals inside the same context
vm.runInContext('minerChart = new Chart(); notificationIntervalId = 1; refreshIntervalId = 2;', context);

const result = vm.runInContext('cleanupEventHandlers(); minerChart;', context);

assert.ok(destroyed, 'chart should be destroyed');
assert.strictEqual(result, null);
assert.deepStrictEqual(cleared, [1, 2]);

console.log('blocks cleanup test passed');
