(function() {
    "use strict";

    function initMatrixRain() {
        const canvas = document.createElement('canvas');
        canvas.id = 'matrixRain';
        canvas.className = 'matrix-rain';
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        let width, height, columns, drops;

        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
            columns = Math.floor(width / 20);
            drops = Array(columns).fill(0);
        }

        function draw() {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#39ff14';
            ctx.font = '16px monospace';

            for (let i = 0; i < drops.length; i++) {
                const text = String.fromCharCode(0x30A0 + Math.random() * 96);
                ctx.fillText(text, i * 20, drops[i] * 20);
                if (drops[i] * 20 > height && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i]++;
            }
        }

        resize();
        window.addEventListener('resize', resize);
        setInterval(draw, 50);
    }

    document.addEventListener('DOMContentLoaded', function() {
        if (localStorage.getItem('useMatrixTheme') === 'true') {
            initMatrixRain();
        }
    });

    window.initMatrixRain = initMatrixRain;
})();
