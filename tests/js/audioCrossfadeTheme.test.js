const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupBasicDOM } = require('./test_utils');

setupBasicDOM();

// Stub Audio class used in the script
class DummyAudio {
    constructor() {
        this.src = '';
        this.volume = 1;
        this.muted = false;
        this.currentTime = 0;
        this.duration = 10;
        this.loop = false;
    }
    load() {}
    play() { return { catch: () => {} }; }
    pause() {}
    addEventListener() {}
    removeEventListener() {}
}

global.Audio = DummyAudio;

// Provide required DOM elements
const audioElement = new DummyAudio();
const nextAudioElement = new DummyAudio();

global.document.getElementById = (id) => {
    switch (id) {
        case 'backgroundAudio':
            return audioElement;
        case 'audioControl':
            return { addEventListener: () => {} };
        case 'audioIcon':
            return { classList: { toggle: () => {}, add: () => {}, remove: () => {} } };
        case 'volumeSlider':
            return { addEventListener: () => {}, value: 100 };
    }
    return null;
};

// Speed up crossfade by running intervals immediately
let intervalFn = null;
global.setInterval = (fn) => { intervalFn = fn; return 1; };

const filePath = path.join(__dirname, '../../static/js/audio.js');
const code = fs.readFileSync(filePath, 'utf8');
const context = { console, document: global.document, window: global.window, Audio: DummyAudio, setInterval: global.setInterval, clearInterval: () => {}, localStorage: global.localStorage };
vm.createContext(context);
vm.runInContext(code, context);

assert.strictEqual(typeof context.window.crossfadeToTheme, 'function');

context.window.crossfadeToTheme(true);
for (let i = 0; i < 20; i++) { intervalFn(); }
assert.strictEqual(audioElement.src, '/static/audio/ocean.mp3');

context.window.crossfadeToTheme(false);
for (let i = 0; i < 20; i++) { intervalFn(); }
assert.strictEqual(audioElement.src, '/static/audio/bitcoin.mp3');

assert.ok(intervalFn);
console.log('audio crossfade theme tests passed');
