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
        let word_cycle_index = 0;

        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
            columns = Math.floor(width / 20);
            drops = Array.from({ length: columns }, () => ({ y: 0, word: null, index: 0 }));
        }

        const charSet =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()[]{}<>?/|~' +
            'ΩβπΣΔΘΛΞΦΨαβγδεζηθικλμνξοπρστυφχψω' +
            'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ';

        const words = ['BITCOIN', 'MATRIX', 'OCEAN'];
        const fonts = [
            '16px "Courier New", monospace',
            '16px "Consolas", monospace',
            '16px "MS Gothic", monospace',
            '16px "Noto Sans JP", monospace'
        ];

        function nextWord() {
            const word = words[word_cycle_index];
            word_cycle_index = (word_cycle_index + 1) % words.length;
            return word;
        }

        function draw() {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#39ff14';

            for (let i = 0; i < drops.length; i++) {
                const drop = drops[i];
                let char;
                if (drop.word) {
                    char = drop.word[drop.index];
                    drop.index += 1;
                    if (drop.index >= drop.word.length) {
                        drop.word = null;
                        drop.index = 0;
                    }
                } else if (Math.random() < 0.0005) {
                    drop.word = nextWord();
                    char = drop.word[0];
                    drop.index = 1;
                } else {
                    char = charSet[Math.floor(Math.random() * charSet.length)];
                }
                ctx.font = fonts[Math.floor(Math.random() * fonts.length)];
                ctx.fillText(char, i * 20, drop.y * 20);
                if (drop.y * 20 > height && Math.random() > 0.975) {
                    drop.y = 0;
                }
                drop.y += 1;
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
