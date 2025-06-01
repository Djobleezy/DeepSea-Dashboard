const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Minimal DOM/storage stubs
const storageStub = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};

global.document = {
    readyState: 'complete',
    getElementById: (id) => {
        if (['btn-30', 'btn-60', 'btn-180'].includes(id)) {
            return { classList: { toggle: () => {} } };
        }
        return null;
    },
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

global.latestMetrics = {
    network_hashrate_variance_3hr: 0,
    network_hashrate_variance_progress: 0,
    currency: 'USD',
    exchange_rates: { USD: 1 },
    daily_revenue: 0,
    daily_power_cost: 0
};

assert.doesNotThrow(() => {
    updateUI();
});

console.log('main DOM safety test passed');
