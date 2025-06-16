const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupBasicDOM } = require('./test_utils');

setupBasicDOM();

// In-memory storage implementation
const storage = (() => {
    const data = {};
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; }
    };
})();

global.localStorage = storage;
global.window.localStorage = storage;

global.document.createElement = () => ({ style: {}, appendChild: () => {}, innerHTML: '', textContent: '' });
global.document.body = { appendChild: () => {} };

global.updateDashboardDataText = () => {};
global.window.cleanupMatrixRain = () => {};
global.window.get_theme_quote = () => 'q';
global.get_theme_quote = () => 'q';
global.window.chartPoints = 180;
global.window.audioCrossfadeDuration = 0;

const crossfadeCalls = [];
global.window.crossfadeToTheme = (v) => { crossfadeCalls.push(v); };

let reloadCalled = false;
global.window.location = { reload: () => { reloadCalled = true; } };

const filePath = path.join(__dirname, '../../static/js/theme.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('function toggleTheme()'));
const saveStart = lines.findIndex((l, i) => i > start && l.includes('function saveThemePreference'));
const snippet = lines.slice(start, saveStart + 7).join('\n');

const context = { console, window: global.window, document: global.document, localStorage: global.localStorage, updateDashboardDataText, get_theme_quote, setTimeout: global.setTimeout };
vm.createContext(context);
vm.runInContext(snippet, context);

context.toggleTheme();
assert.strictEqual(storage.getItem('useDeepSeaTheme'), 'true');
assert.strictEqual(storage.getItem('useMatrixTheme'), 'false');
assert.strictEqual(crossfadeCalls[0], 'deepsea');
assert.ok(reloadCalled);

reloadCalled = false;
context.toggleTheme();
assert.strictEqual(storage.getItem('useDeepSeaTheme'), 'false');
assert.strictEqual(crossfadeCalls[1], 'bitcoin');
assert.ok(reloadCalled);

console.log('theme toggle tests passed');
