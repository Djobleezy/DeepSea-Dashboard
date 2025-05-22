// Background audio controls

(function() {
    let audio;
    let control;
    let icon;

    function play() {
        const promise = audio.play();
        if (promise !== undefined) {
            promise.catch(() => {});
        }
    }

    function apply_audio_theme(useDeepSea) {
        if (!audio) {
            return;
        }
        if (useDeepSea) {
            audio.muted = false;
            play();
            if (icon) {
                icon.classList.remove('fa-volume-mute');
                icon.classList.add('fa-volume-up');
            }
        } else {
            audio.muted = true;
            audio.pause();
            if (icon) {
                icon.classList.remove('fa-volume-up');
                icon.classList.add('fa-volume-mute');
            }
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        audio = document.getElementById('backgroundAudio');
        control = document.getElementById('audioControl');
        icon = document.getElementById('audioIcon');

        if (!audio) {
            return;
        }

        audio.volume = 1.00;

        const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
        apply_audio_theme(useDeepSea);

        if (control) {
            control.addEventListener('click', function() {
                if (audio.muted || audio.paused) {
                    apply_audio_theme(true);
                } else {
                    apply_audio_theme(false);
                }
            });
        }

        window.applyAudioTheme = apply_audio_theme;
    });
})();
