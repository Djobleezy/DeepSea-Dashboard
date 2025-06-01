const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupBasicDOM } = require('./test_utils');

setupBasicDOM();

const items = [
    {
        attributes: { 'data-timestamp': '2024-01-01T00:00:00Z' },
        attr(name) { return this.attributes[name]; },
        find(selector) {
            if (selector === '.notification-time') {
                return { text: t => { this.time = t; } };
            }
            if (selector === '.full-timestamp') {
                return { text: t => { this.full = t; }, length: 1 };
            }
            return { length: 0, text: () => {} };
        }
    },
    {
        attributes: { 'data-timestamp': '2024-01-01T00:05:00Z' },
        attr(name) { return this.attributes[name]; },
        find(selector) {
            if (selector === '.notification-time') {
                return { text: t => { this.time = t; } };
            }
            if (selector === '.full-timestamp') {
                return { text: t => { this.full = t; }, length: 1 };
            }
            return { length: 0, text: () => {} };
        }
    }
];

global.$ = (selector) => {
    if (selector === '.notification-item') {
        return { each: cb => items.forEach(item => cb.call(item)) };
    }
    if (typeof selector === 'object') {
        return selector;
    }
    return { html: () => {}, show: () => {}, hide: () => {}, prop: () => {}, append: () => {} };
};

global.window.dashboardTimezone = 'UTC';

const filePath = path.join(__dirname, '../../static/js/notifications.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('function updateNotificationTimestamps'));
const end = lines.findIndex(l => l.includes('function showLoading'));
const snippet = lines.slice(start, end).join('\n');

const context = { console, window: global.window, $ };
context.formatTimestamp = () => 'formatted';
vm.createContext(context);
vm.runInContext(snippet, context);

context.updateNotificationTimestamps();

assert.ok(typeof items[0].time === 'string');
assert.ok(typeof items[0].full === 'string');
assert.ok(typeof items[1].time === 'string');
assert.ok(typeof items[1].full === 'string');

console.log('notification timestamp update tests passed');
