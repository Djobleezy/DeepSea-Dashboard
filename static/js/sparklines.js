'use strict';

/**
 * SparklineModule - renders tiny line charts inline with metrics.
 */
(function () {
    const charts = {};
    let lastTheme = null;

    function ensureCanvas(id) {
        let canvas = document.getElementById(id);
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = id;
            canvas.className = 'sparkline';
            canvas.width = 60;
            canvas.height = 16;
        }
        return canvas;
    }

    /**
     * Initialize sparkline canvases and ensure metrics are structured
     * consistently so the charts appear inline with the metric value.
     */
    function initSparklines() {
        // Metrics under the Payout Info section don't require sparklines
        const skipKeys = new Set([
            'workers_hashing',
            'unpaid_earnings',
            'pool_fees_percentage',
            'last_block',
            'est_time_to_payout'
        ]);

        document.querySelectorAll('[id^="indicator_"]').forEach(indicator => {
            const key = indicator.id.replace('indicator_', '');
            if (skipKeys.has(key)) {
                return; // skip sparklines for specified metrics
            }

            const canvas = ensureCanvas(`sparkline_${key}`);

            // Ensure a container span so the metric, indicator and chart
            // share the same grid cell regardless of divider usage
            let mainMetric = indicator.closest('.main-metric');
            if (!mainMetric) {
                const metricEl = document.getElementById(key);
                if (metricEl && metricEl.parentNode === indicator.parentNode) {
                    mainMetric = document.createElement('span');
                    mainMetric.className = 'main-metric';
                    metricEl.parentNode.insertBefore(mainMetric, metricEl);
                    mainMetric.appendChild(metricEl);
                    mainMetric.appendChild(indicator);
                }
            }

            const container = mainMetric || indicator.parentNode;
            if (!canvas.parentNode || canvas.parentNode !== container) {
                container.appendChild(canvas);
            }
        });
    }

    function updateSparklines(data) {
        if (!window.Chart || !data.arrow_history) {
            return;
        }
        const theme = window.getCurrentTheme ? window.getCurrentTheme() : { PRIMARY: '#0088cc' };
        if (lastTheme !== theme) {
            lastTheme = theme;
        }

        Object.entries(data.arrow_history).forEach(([key, list]) => {
            const canvasId = `sparkline_${key}`;
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                const existing = charts[canvasId];
                if (existing) {
                    existing.destroy();
                    delete charts[canvasId];
                }
                return;
            }

            const values = list.map(v => parseFloat(v.value)).filter(v => !isNaN(v));
            if (values.length === 0) {
                return;
            }

            let chart = charts[canvasId];
            const labels = values.map((_, i) => i);

            if (chart && !document.contains(canvas)) {
                chart.destroy();
                delete charts[canvasId];
                chart = null;
            }

            if (!chart) {
                chart = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: { labels: labels, datasets: [{
                        data: values,
                        borderColor: theme.PRIMARY,
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false
                    }] },
                    options: {
                        responsive: false,
                        animation: false,
                        scales: { x: { display: false }, y: { display: false } },
                        plugins: {
                            legend: { display: false },
                            tooltip: { enabled: false }
                        }
                    }
                });
                chart._theme = theme;
                charts[canvasId] = chart;
            } else {
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                if (chart._theme !== theme) {
                    chart.data.datasets[0].borderColor = theme.PRIMARY;
                    chart._theme = theme;
                }
                chart.update();
            }
        });
    }

    function destroySparklines() {
        Object.values(charts).forEach(chart => chart.destroy());
        Object.keys(charts).forEach(id => delete charts[id]);
    }

    window.addEventListener('beforeunload', destroySparklines);

    window.SparklineModule = { initSparklines, updateSparklines, destroySparklines };
})();

