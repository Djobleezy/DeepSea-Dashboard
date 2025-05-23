// Background audio controls

(function () {
    document.addEventListener('DOMContentLoaded', function () {
        let audio = document.getElementById('backgroundAudio');
        let nextAudio = new Audio();
        const control = document.getElementById('audioControl');
        const icon = document.getElementById('audioIcon');
        const volumeSlider = document.getElementById('volumeSlider');
        if (!audio) { return; }
        const crossfadeDuration = 2;
        let isCrossfading = false;

        const isDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
        const deepSeaTracks = ['/static/audio/ocean.mp3'];
        const bitcoinTracks = ['/static/audio/bitcoin.mp3', '/static/audio/bitcoin1.mp3', '/static/audio/bitcoin2.mp3'];
        let playlist = isDeepSea ? deepSeaTracks : bitcoinTracks;

        let trackIndex = parseInt(localStorage.getItem('audioTrackIndex')) || 0;
        if (trackIndex >= playlist.length) {
            trackIndex = 0;
        }

        const loadTrack = (element, index) => {
            element.src = playlist[index];
            element.load();
        };
        loadTrack(audio, trackIndex);
        loadTrack(nextAudio, (trackIndex + 1) % playlist.length);
        audio.loop = playlist.length === 1;

        const storedVolume = parseFloat(localStorage.getItem('audioVolume'));
        let baseVolume;
        if (!Number.isNaN(storedVolume)) {
            baseVolume = storedVolume;
            audio.volume = baseVolume;
            if (volumeSlider) {
                volumeSlider.value = Math.round(storedVolume * 100);
            }
        } else {
            baseVolume = 1.00;
            audio.volume = baseVolume;
            if (volumeSlider) {
                volumeSlider.value = 100;
            }
        }

        let storedTime = parseFloat(localStorage.getItem('audioPlaybackTime'));
        const storedMuted = localStorage.getItem('audioMuted') === 'true';
        const wasPaused = localStorage.getItem('audioPaused') === 'true';

        const play = () => {
            const promise = audio.play();
            if (promise !== undefined) {
                promise.catch(() => { });
            }
        };

        const loadAndResume = () => {
            const resume = () => {
                if (!Number.isNaN(storedTime)) {
                    audio.currentTime = storedTime;
                }
                if (!wasPaused && !storedMuted) {
                    play();
                }
                audio.removeEventListener('loadedmetadata', resume);
            };

            if (audio.readyState > 0) {
                resume();
            } else {
                audio.addEventListener('loadedmetadata', resume);
            }
        };

        const startCrossfade = () => {
            if (isCrossfading) { return; }
            isCrossfading = true;
            const nextIndex = (trackIndex + 1) % playlist.length;
            loadTrack(nextAudio, nextIndex);
            nextAudio.volume = 0;
            nextAudio.muted = audio.muted;
            nextAudio.play().catch(() => { });
            const steps = 20;
            const interval = (crossfadeDuration * 1000) / steps;
            let step = 0;
            const fade = setInterval(() => {
                step += 1;
                const ratio = step / steps;
                audio.volume = baseVolume * (1 - ratio);
                nextAudio.volume = baseVolume * ratio;
                if (step >= steps) {
                    clearInterval(fade);
                    audio.pause();
                    audio.volume = baseVolume;
                    audio.removeEventListener('timeupdate', timeUpdateHandler);
                    const old = audio;
                    audio = nextAudio;
                    nextAudio = old;
                    trackIndex = nextIndex;
                    loadTrack(nextAudio, (trackIndex + 1) % playlist.length);
                    audio.addEventListener('timeupdate', timeUpdateHandler);
                    storedTime = 0;
                    isCrossfading = false;
                }
            }, interval);
        };

        const crossfadeToTheme = (useDeepSea) => {
            if (isCrossfading) { return; }
            const newPlaylist = useDeepSea ? deepSeaTracks : bitcoinTracks;
            if (playlist === newPlaylist) { return; }
            playlist = newPlaylist;
            trackIndex = 0;
            audio.loop = playlist.length === 1;
            isCrossfading = true;
            loadTrack(nextAudio, trackIndex);
            nextAudio.volume = 0;
            nextAudio.muted = audio.muted;
            nextAudio.play().catch(() => { });
            const steps = 20;
            const interval = (crossfadeDuration * 1000) / steps;
            let step = 0;
            const fade = setInterval(() => {
                step += 1;
                const ratio = step / steps;
                audio.volume = baseVolume * (1 - ratio);
                nextAudio.volume = baseVolume * ratio;
                if (step >= steps) {
                    clearInterval(fade);
                    audio.pause();
                    audio.volume = baseVolume;
                    audio.removeEventListener('timeupdate', timeUpdateHandler);
                    const old = audio;
                    audio = nextAudio;
                    nextAudio = old;
                    loadTrack(nextAudio, (trackIndex + 1) % playlist.length);
                    audio.addEventListener('timeupdate', timeUpdateHandler);
                    storedTime = 0;
                    isCrossfading = false;
                }
            }, interval);
        };

        window.crossfadeToTheme = crossfadeToTheme;
        window.audioCrossfadeDuration = crossfadeDuration;

        loadAndResume();

        audio.muted = storedMuted;
        if (icon) {
            icon.classList.toggle('fa-volume-mute', storedMuted);
            icon.classList.toggle('fa-volume-up', !storedMuted);
        }
        
        const timeUpdateHandler = () => {
            localStorage.setItem('audioPlaybackTime', audio.currentTime);
            if (
                playlist.length > 1 &&
                audio.duration &&
                !isCrossfading &&
                audio.currentTime >= audio.duration - crossfadeDuration
            ) {
                startCrossfade();
            }
        };

        audio.addEventListener('timeupdate', timeUpdateHandler);

        if (playlist.length > 1) {
            audio.addEventListener('ended', () => {
                trackIndex = (trackIndex + 1) % playlist.length;
                loadTrack(audio, trackIndex);
                loadTrack(nextAudio, (trackIndex + 1) % playlist.length);
                storedTime = 0;
                loadAndResume();
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', function () {
                const volume = parseInt(this.value, 10) / 100;
                baseVolume = volume;
                audio.volume = volume;
                nextAudio.volume = volume;
                localStorage.setItem('audioVolume', volume.toString());
            });
        }

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
