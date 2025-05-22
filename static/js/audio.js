// Background audio controls

(function () {
    document.addEventListener('DOMContentLoaded', function () {
        const audio = document.getElementById('backgroundAudio');
        const control = document.getElementById('audioControl');
        const icon = document.getElementById('audioIcon');
        if (!audio) { return; }

        audio.volume = 1.00;

        const setPosition = () => {
            const storedTime = parseFloat(localStorage.getItem('audioPlaybackTime'));
            if (!Number.isNaN(storedTime)) {
                audio.currentTime = storedTime;
            }
        };

        if (audio.readyState > 0) {
            setPosition();
        } else {
            audio.addEventListener('loadedmetadata', setPosition);
        }

        const storedMuted = localStorage.getItem('audioMuted') === 'true';
        const wasPaused = localStorage.getItem('audioPaused') === 'true';
        audio.muted = storedMuted;
        if (icon) {
            icon.classList.toggle('fa-volume-mute', storedMuted);
            icon.classList.toggle('fa-volume-up', !storedMuted);
        }

        const play = () => {
            const promise = audio.play();
            if (promise !== undefined) {
                promise.catch(() => { });
            }
        };

        if (!wasPaused && !storedMuted) {
            play();
        }

        audio.addEventListener('timeupdate', () => {
            localStorage.setItem('audioPlaybackTime', audio.currentTime);
        });

        window.addEventListener('beforeunload', () => {
            localStorage.setItem('audioPlaybackTime', audio.currentTime);
            localStorage.setItem('audioMuted', audio.muted.toString());
            localStorage.setItem('audioPaused', audio.paused.toString());
        });

        if (control) {
            control.addEventListener('click', function () {
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
                localStorage.setItem('audioMuted', audio.muted.toString());
                localStorage.setItem('audioPaused', audio.paused.toString());
            });
        }
    });
})();
