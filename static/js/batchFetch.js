(function() {
    const originalFetch = window.fetch.bind(window);
    const queue = [];
    let timer = null;

    function flush() {
        const batch = queue.splice(0);
        timer = null;
        const requests = batch.map(item => {
            const [resolve, reject, input, init] = item;
            const url = typeof input === 'string' ? input : input.url;
            const u = new URL(url, window.location.origin);
            const path = u.pathname + u.search;
            return {
                method: (init && init.method) || 'GET',
                path,
                body: init && init.body ? JSON.parse(init.body) : undefined,
                params: undefined
            };
        });
        originalFetch('/api/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests })
        })
            .then(r => r.json())
            .then(data => {
                data.responses.forEach((res, idx) => {
                    const response = new Response(JSON.stringify(res.body), {
                        status: res.status,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    batch[idx][0](response);
                });
            })
            .catch(err => {
                batch.forEach(item => item[1](err));
            });
    }

    window.fetch = function(input, init = {}) {
        const url = typeof input === 'string' ? input : input.url;
        if (url.startsWith('/api/') && !url.startsWith('/api/batch') && !init.noBatch) {
            return new Promise((resolve, reject) => {
                queue.push([resolve, reject, input, init]);
                if (!timer) {
                    timer = setTimeout(flush, 10);
                }
            });
        }
        return originalFetch(input, init);
    };
})();
