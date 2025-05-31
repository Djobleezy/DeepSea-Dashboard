const assert = require('assert');
const formatCurrency = require('../../static/js/formatCurrency');

assert.strictEqual(formatCurrency(1000), '1,000');
assert.strictEqual(formatCurrency(1234567), '1,234,567');
assert.strictEqual(formatCurrency('2500'), '2,500');
console.log('formatCurrency tests passed');
