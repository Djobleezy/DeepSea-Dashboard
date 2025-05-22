// Background audio controls

(function () {
    document.addEventListener('DOMContentLoaded', function () {
        const audio = document.getElementById('backgroundAudio');
        const control = document.getElementById('audioControl');
        const icon = document.getElementById('audioIcon');
        if (!audio) { return; }

        const isDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
        const playlist = isDeepSea
            ? ['/static/audio/ocean.mp3']
            : ['/static/audio/bitcoin.mp3', '/static/audio/bitcoin1.mp3', '/static/audio/bitcoin2.mp3'];

        let trackIndex = parseInt(localStorage.getItem('audioTrackIndex')) || 0;
        if (trackIndex >= playlist.length) {
            trackIndex = 0;
        }

        const loadTrack = (index) => {
            audio.src = playlist[index];
            audio.load();
        };
        loadTrack(trackIndex);
        audio.loop = playlist.length === 1;

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

        if (playlist.length > 1) {
            audio.addEventListener('ended', () => {
                trackIndex = (trackIndex + 1) % playlist.length;
                loadTrack(trackIndex);
                play();
            });
        }

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
            localStorage.setItem('audioTrackIndex', trackIndex.toString());
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
