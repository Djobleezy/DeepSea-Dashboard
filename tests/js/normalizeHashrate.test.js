const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Minimal DOM/storage stubs reused from other tests
const storageStub = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};

global.document = {
    readyState: 'complete',
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    body: {}
};

global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: storageStub,
    sessionStorage: storageStub,
    navigator: {},
    Chart: function(){}
};

global.localStorage = storageStub;
global.sessionStorage = storageStub;
global.MutationObserver = function () { this.observe = () => {}; };
global.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };

global.$ = function () {
    const obj = {};
    obj.text = () => obj;
    obj.attr = () => obj;
    obj.remove = () => obj;
    obj.after = () => obj;
    obj.parent = () => ({ after: () => obj, append: () => obj });
    obj.is = () => false;
    obj.css = () => obj;
    obj.append = () => obj;
    obj.empty = () => obj;
    obj.hide = () => obj;
    obj.show = () => obj;
    obj.on = () => obj;
    obj.off = () => obj;
    obj.keydown = () => obj;
    obj.ready = () => obj;
    obj.prop = () => obj;
    obj.html = () => obj;
    obj.appendTo = () => obj;
    obj.each = () => obj;
    return obj;
};

const code = fs.readFileSync(__dirname + '/../../static/js/main.js', 'utf8');
vm.runInThisContext(code);

assert.strictEqual(typeof normalizeHashrate, 'function');

assert.strictEqual(normalizeHashrate(1, 'ph/s'), 1000);
assert.strictEqual(normalizeHashrate(500, 'gh/s'), 0.5);
assert.strictEqual(normalizeHashrate('', 'th/s'), 0);
assert.strictEqual(normalizeHashrate(2, 'unknown-unit'), 2);

console.log('normalizeHashrate tests passed');
