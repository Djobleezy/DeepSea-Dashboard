const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { setupBasicDOM, setupJqueryStub } = require('./test_utils');

setupBasicDOM();
setupJqueryStub();

// Prevent automatic execution of DOMContentLoaded handlers
global.document.addEventListener = () => {};

// Provide a canvas element for the chart
const canvasStub = {
    getContext: () => ({})
};

global.document.getElementById = (id) => {
    if (['btn-30', 'btn-60', 'btn-180'].includes(id)) {
        return { classList: { toggle: () => {} } };
    }
    if (id === 'trendGraph') {
        return canvasStub;
    }
    return null;
};

let chartCalled = false;
function Chart(ctx, config) {
    chartCalled = true;
    this.ctx = ctx;
    this.config = config;
}

global.window.Chart = Chart;
global.Chart = Chart;

global.getCurrentTheme = () => ({
    PRIMARY: '#fff',
    PRIMARY_RGB: '255,255,255',
    CHART: {
        GRADIENT_START: '#000',
        GRADIENT_END: '#111',
        ANNOTATION: '#222',
        BLOCK_EVENT: '#333'
    }
});

const code = fs.readFileSync(__dirname + '/../../static/js/main.js', 'utf8');
vm.runInThisContext(code);

const chart = initializeChart();

assert.ok(chart, 'initializeChart should return a chart instance');
assert.ok(chartCalled, 'Chart constructor should be called');
assert.strictEqual(chart.config.type, 'line');

console.log('main chart load test passed');
