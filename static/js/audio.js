// Background audio controls

(function() {
    document.addEventListener('DOMContentLoaded', function() {
        const audio = document.getElementById('backgroundAudio');
        const control = document.getElementById('audioControl');
        const icon = document.getElementById('audioIcon');
        if (!audio) { return; }
        audio.volume = 0.05;
        const play = () => {
            const promise = audio.play();
            if (promise !== undefined) {
                promise.catch(() => {});
            }
        };
        play();
        if (control) {
            control.addEventListener('click', function() {
                if (audio.muted || audio.paused) {
                    audio.muted = false;
                    play();
                    icon.classList.remove('fa-volume-mute');
                    icon.classList.add('fa-volume-up');
                } else {
                    audio.muted = true;
                    audio.pause();
                    icon.classList.remove('fa-volume-up');
                    icon.classList.add('fa-volume-mute');
                }
            });
        }
    });
})();
