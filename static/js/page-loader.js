// page-loader.js
(function(global){
    function getEmoji() {
        var useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
        return useDeepSea ? '🌊' : '₿';
    }

    function ensureLoader() {
        var loader = document.getElementById('page-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'page-loader';

            var icon = document.createElement('div');
            icon.id = 'page-loader-icon';
            loader.appendChild(icon);

            var text = document.createElement('div');
            text.id = 'page-loader-text';
            loader.appendChild(text);

            document.body.appendChild(loader);
        }
        return loader;
    }

    function show(message) {
        var loader = ensureLoader();
        loader.querySelector('#page-loader-icon').innerHTML = getEmoji();
        loader.querySelector('#page-loader-text').textContent = message || 'Loading...';
        loader.style.display = 'flex';
    }

    function hide() {
        var loader = document.getElementById('page-loader');
        if (loader) loader.style.display = 'none';
    }

    global.PageLoader = { show: show, hide: hide };
})(window);
