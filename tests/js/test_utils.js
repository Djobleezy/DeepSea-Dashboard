function setupBasicDOM() {
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
        addEventListener: (event, cb) => { if (event === 'DOMContentLoaded' && typeof cb === 'function') cb(); },
        body: {}
    };

    global.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        localStorage: storageStub,
        sessionStorage: storageStub,
        navigator: {},
        Chart: function () {}
    };

    global.localStorage = storageStub;
    global.sessionStorage = storageStub;
    global.MutationObserver = function () { this.observe = () => {}; };
    global.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
    global.setInterval = (fn) => { if (typeof fn === 'function') fn(); return 0; };
    global.clearInterval = () => {};
}

function setupJqueryStub() {
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
        obj.find = () => obj;
        obj.length = 1;
        return obj;
    };
}

module.exports = { setupBasicDOM, setupJqueryStub };
