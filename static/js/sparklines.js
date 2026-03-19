'use strict';

/**
 * SparklineModule - Renders clear, readable mini-charts for key metrics.
 *
 * Sparklines render as block-level elements beneath the metric value
 * with gradient fills, current-value dots, and adaptive sizing.
 */
(function () {
    const charts = {};
    let lastTheme = null;

    // Which metrics get sparklines and their display config
    const SPARKLINE_CONFIG = {
        pool_total_hashrate: { label: 'Pool', color: null },  // null = use theme primary
        hashrate_24hr:       { label: '24hr', color: null },
        btc_price:           { label: 'BTC',  color: '#ffd700' },
        network_hashrate:    { label: 'Net',  color: '#8888ff' },
        daily_mined_sats:    { label: 'Sats', color: '#ffd700' },
        blocks_found:        { label: 'Blocks', color: '#32cd32' },
    };

    function ensureCanvas(id) {
        let canvas = document.getElementById(id);
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = id;
            canvas.className = 'sparkline';
        }
        return canvas;
    }

    /**
     * Place sparkline canvases below their metric values.
     */
    function initSparklines() {
        Object.keys(SPARKLINE_CONFIG).forEach(key => {
            const indicator = document.getElementById(`indicator_${key}`);
            if (!indicator) return;

            const canvas = ensureCanvas(`sparkline_${key}`);

            // Find the parent <p> or container that holds this metric line
            const metricLine = indicator.closest('p') || indicator.parentNode;
            if (!metricLine) return;

            // Create a wrapper div for the sparkline if it doesn't exist
            let wrapper = document.getElementById(`sparkwrap_${key}`);
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.id = `sparkwrap_${key}`;
                wrapper.className = 'sparkline-wrapper';
                // Insert after the metric line
                metricLine.parentNode.insertBefore(wrapper, metricLine.nextSibling);
            }

            if (!canvas.parentNode || canvas.parentNode !== wrapper) {
                wrapper.appendChild(canvas);
            }
        });
    }

    function getThemeColor() {
        const theme = window.getCurrentTheme ? window.getCurrentTheme() : null;
        return theme && theme.PRIMARY ? theme.PRIMARY : '#0088cc';
    }

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 136, b: 204 };
    }

    function updateSparklines(data) {
        if (!window.Chart || !data.arrow_history) return;

        const themeColor = getThemeColor();

        Object.entries(SPARKLINE_CONFIG).forEach(([key, config]) => {
            const list = data.arrow_history[key];
            if (!list || list.length === 0) return;

            const canvasId = `sparkline_${key}`;
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;

            // Extract values and normalize hashrates
            const values = list.map(entry => {
                let val = parseFloat(entry.value);
                if (isNaN(val)) return null;
                // Normalize hashrates to TH/s for consistent comparison
                if (key.includes('hashrate') && entry.unit && window.normalizeHashrate) {
                    val = window.normalizeHashrate(val, entry.unit);
                }
                return val;
            }).filter(v => v !== null);

            if (values.length < 2) return;

            const lineColor = config.color || themeColor;
            const rgb = hexToRgb(lineColor);
            const labels = values.map((_, i) => i);

            let chart = charts[canvasId];

            // Destroy chart if canvas was removed and re-added
            if (chart && !document.contains(canvas)) {
                chart.destroy();
                delete charts[canvasId];
                chart = null;
            }

            if (!chart) {
                const ctx = canvas.getContext('2d');

                chart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: values,
                            borderColor: lineColor,
                            borderWidth: 1.5,
                            pointRadius: 0,
                            pointHoverRadius: 3,
                            pointHoverBackgroundColor: lineColor,
                            tension: 0.3,
                            fill: true,
                            backgroundColor: function(context) {
                                const chart = context.chart;
                                const { ctx, chartArea } = chart;
                                if (!chartArea) return `rgba(${rgb.r},${rgb.g},${rgb.b},0.1)`;
                                const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                                gradient.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.25)`);
                                gradient.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.02)`);
                                return gradient;
                            }
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 300 },
                        layout: { padding: { left: 0, right: 0, top: 2, bottom: 0 } },
                        scales: {
                            x: { display: false },
                            y: {
                                display: false,
                                // Add 5% padding above and below data range
                                afterDataLimits: (scale) => {
                                    const range = scale.max - scale.min;
                                    const pad = range * 0.05 || 1;
                                    scale.min -= pad;
                                    scale.max += pad;
                                }
                            }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                enabled: true,
                                mode: 'index',
                                intersect: false,
                                displayColors: false,
                                backgroundColor: 'rgba(0,0,0,0.8)',
                                titleFont: { size: 0 },
                                bodyFont: { family: 'var(--terminal-font, monospace)', size: 11 },
                                callbacks: {
                                    title: () => '',
                                    label: (ctx) => {
                                        const val = ctx.parsed.y;
                                        if (key.includes('hashrate')) {
                                            return window.formatHashrateForDisplay
                                                ? window.formatHashrateForDisplay(val, 'th/s')
                                                : val.toFixed(1) + ' TH/s';
                                        }
                                        if (key === 'btc_price') return '$' + val.toLocaleString();
                                        if (key.includes('sats')) return val.toLocaleString() + ' sats';
                                        return val.toLocaleString();
                                    }
                                }
                            }
                        },
                        interaction: {
                            mode: 'index',
                            intersect: false
                        },
                        // Show endpoint dot
                        elements: {
                            point: {
                                radius: function(context) {
                                    return context.dataIndex === context.dataset.data.length - 1 ? 3 : 0;
                                },
                                backgroundColor: lineColor,
                                borderWidth: 0
                            }
                        }
                    },
                    plugins: [{
                        // Custom plugin: draw a dot at the latest value
                        id: 'endpointDot',
                        afterDatasetsDraw(chart) {
                            const dataset = chart.data.datasets[0];
                            if (!dataset || dataset.data.length === 0) return;
                            const meta = chart.getDatasetMeta(0);
                            const lastPoint = meta.data[meta.data.length - 1];
                            if (!lastPoint) return;
                            const ctx = chart.ctx;
                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
                            ctx.fillStyle = lineColor;
                            ctx.fill();
                            // Glow effect
                            ctx.beginPath();
                            ctx.arc(lastPoint.x, lastPoint.y, 5, 0, Math.PI * 2);
                            ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.3)`;
                            ctx.fill();
                            ctx.restore();
                        }
                    }]
                });
                charts[canvasId] = chart;
            } else {
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                chart.data.datasets[0].borderColor = lineColor;
                chart.update('none');  // No animation on updates
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

// Theme change handler
if (window.jQuery) {
    window.jQuery(document).on('themeChanged', function () {
        if (typeof latestMetrics !== 'undefined' && latestMetrics && window.SparklineModule) {
            window.SparklineModule.updateSparklines(latestMetrics);
        }
    });
}
