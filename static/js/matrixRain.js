(function() {
    "use strict";

    let matrixIntervalId = null;
    let resizeHandler = null;

    function initMatrixRain() {
        if (document.getElementById('matrixRain')) {
            cleanupMatrixRain();
        }

        const canvas = document.createElement('canvas');
        canvas.id = 'matrixRain';
        canvas.className = 'matrix-rain';
        // Insert the canvas as the first element so it stays behind
        document.body.insertBefore(canvas, document.body.firstChild);

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

        const charSet =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()[]{}<>?/|~' +
            'ΩβπΣΔΘΛΞΦΨαβγδεζηθικλμνξοπρστυφχψω' +
            'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ';

        const words = ['OCEAN', 'BITCOIN', 'MATRIX'];
        const fonts = [
            '16px "Courier New", monospace',
            '16px "Consolas", monospace',
            '16px "MS Gothic", monospace',
            '16px "Noto Sans JP", monospace'
        ];

        function draw() {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#39ff14';

            for (let i = 0; i < drops.length; i++) {
                let text;
                if (Math.random() < 0.0005) {
                    text = words[Math.floor(Math.random() * words.length)];
                } else {
                    text = charSet[Math.floor(Math.random() * charSet.length)];
                }
                ctx.font = fonts[Math.floor(Math.random() * fonts.length)];
                ctx.fillText(text, i * 20, drops[i] * 20);
                if (drops[i] * 20 > height && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i]++;
            }
        }

        resize();
        resizeHandler = resize;
        window.addEventListener('resize', resizeHandler);
        matrixIntervalId = setInterval(draw, 50);
    }

    function cleanupMatrixRain() {
        const canvas = document.getElementById('matrixRain');
        if (canvas) {
            canvas.remove();
        }
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            resizeHandler = null;
        }
        if (matrixIntervalId) {
            clearInterval(matrixIntervalId);
            matrixIntervalId = null;
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        if (localStorage.getItem('useMatrixTheme') === 'true') {
            initMatrixRain();
        }
    });

    window.initMatrixRain = initMatrixRain;
    window.cleanupMatrixRain = cleanupMatrixRain;
})();
