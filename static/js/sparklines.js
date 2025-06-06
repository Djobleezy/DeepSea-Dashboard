'use strict';

/**
 * SparklineModule - renders tiny line charts inline with metrics.
 */
(function () {
    const charts = {};

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
        const skipKeys = new Set(['workers_hashing', 'unpaid_earnings']);

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
        Object.entries(data.arrow_history).forEach(([key, list]) => {
            const canvasId = `sparkline_${key}`;
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                return;
            }
            const values = list.map(v => parseFloat(v.value)).filter(v => !isNaN(v));
            if (values.length === 0) {
                return;
            }
            let chart = charts[canvasId];
            const labels = values.map((_, i) => i);
            if (!chart) {
                chart = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: { labels: labels, datasets: [{
                        data: values,
                        borderColor: '#0088cc',
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false
                    }] },
                    options: {
                        responsive: false,
                        animation: false,
                        scales: { x: { display: false }, y: { display: false } },
                        plugins: { legend: { display: false } }
                    }
                });
                charts[canvasId] = chart;
            } else {
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                chart.update();
            }
        });
    }

    window.SparklineModule = { initSparklines, updateSparklines };
})();

