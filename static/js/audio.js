// Background audio controls

(function () {
    document.addEventListener('DOMContentLoaded', function () {
        let audio = document.getElementById('backgroundAudio');
        let nextAudio = new Audio();
        const control = document.getElementById('audioControl');
        const icon = document.getElementById('audioIcon');
        const volumeSlider = document.getElementById('volumeSlider');
        const playBtn = document.getElementById('audio-play');
        const prevBtn = document.getElementById('audio-prev');
        const nextBtn = document.getElementById('audio-next');
        let progressBar = document.getElementById('audio-progress');
        let timeDisplay = document.getElementById('audio-remaining');
        let showRemaining = true;
        let rootStyle = null;
        let primaryColor = '';
        let primaryRgb = '';
        if (typeof getComputedStyle === 'function') {
            rootStyle = getComputedStyle(document.documentElement);
            primaryColor = rootStyle.getPropertyValue('--primary-color').trim();
            primaryRgb = rootStyle.getPropertyValue('--primary-color-rgb').trim();
        }
        if (!audio) { return; }
        const crossfadeDuration = 2;
        let isCrossfading = false;

        const isDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
        const isMatrix = localStorage.getItem('useMatrixTheme') === 'true';
        const deepSeaTracks = ['/static/audio/ocean.mp3'];
        const bitcoinTracks = ['/static/audio/bitcoin.mp3', '/static/audio/bitcoin1.mp3', '/static/audio/bitcoin2.mp3'];
        const matrixTracks = ['/static/audio/matrix.mp3', '/static/audio/matrix1.mp3', '/static/audio/matrix2.mp3'];

        let playlist;
        if (isMatrix) {
            playlist = matrixTracks;
        } else if (isDeepSea) {
            playlist = deepSeaTracks;
        } else {
            playlist = bitcoinTracks;
        }

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
        const updateVolumeSliderStyle = () => {
            if (volumeSlider && volumeSlider.style) {
                const pct = parseInt(volumeSlider.value, 10);
                volumeSlider.style.setProperty('--volume-progress-value', pct + '%');
            }
        };
        updateVolumeSliderStyle();

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
                updateProgress();
                updatePlayButton();
            };

            if (audio.readyState > 0) {
                resume();
            } else {
                audio.addEventListener('loadedmetadata', resume);
            }
        };

        const formatTime = (seconds) => {
            if (Number.isNaN(seconds)) return '0:00';
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        const crossfadeToIndex = (index) => {
            if (isCrossfading) { return; }
            isCrossfading = true;
            audio.removeEventListener('ended', onTrackEnded);
            const nextIndex = index;
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
                    audio.removeEventListener('ended', onTrackEnded);
                    const old = audio;
                    audio = nextAudio;
                    nextAudio = old;
                    trackIndex = nextIndex;
                    loadTrack(nextAudio, (trackIndex + 1) % playlist.length);
                    audio.addEventListener('timeupdate', timeUpdateHandler);
                    audio.addEventListener('ended', onTrackEnded);
                    storedTime = 0;
                    updateProgress();
                    updatePlayButton();
                    isCrossfading = false;
                }
            }, interval);
        };

        const startCrossfade = () => {
            crossfadeToIndex((trackIndex + 1) % playlist.length);
        };

        const crossfadeToTheme = (theme) => {
            if (isCrossfading) { return; }
            if (typeof theme === 'boolean') {
                theme = theme ? 'deepsea' : 'bitcoin';
            }
            const newPlaylist = theme === 'deepsea'
                ? deepSeaTracks
                : theme === 'matrix'
                    ? matrixTracks
                    : bitcoinTracks;
            if (playlist === newPlaylist) { return; }
            playlist = newPlaylist;
            trackIndex = 0;
            audio.loop = playlist.length === 1;
            isCrossfading = true;
            audio.removeEventListener('ended', onTrackEnded);
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
                    audio.removeEventListener('ended', onTrackEnded);
                    const old = audio;
                    audio = nextAudio;
                    nextAudio = old;
                    loadTrack(nextAudio, (trackIndex + 1) % playlist.length);
                    audio.addEventListener('timeupdate', timeUpdateHandler);
                    audio.addEventListener('ended', onTrackEnded);
                    storedTime = 0;
                    updateProgress();
                    updatePlayButton();
                    isCrossfading = false;
                }
            }, interval);
        };

        const nextTrack = () => {
            if (playlist.length > 1) {
                crossfadeToIndex((trackIndex + 1) % playlist.length);
            }
        };

        const prevTrack = () => {
            if (playlist.length > 1) {
                const prevIndex = (trackIndex - 1 + playlist.length) % playlist.length;
                crossfadeToIndex(prevIndex);
            }
        };

        const updatePlayButton = () => {
            if (playBtn) {
                playBtn.textContent = audio.paused ? '\u25B6' : '\u275A\u275A';
            }
        };

        const togglePlay = () => {
            if (audio.paused) {
                audio.muted = false;
                play();
                if (icon) {
                    icon.classList.remove('fa-volume-mute');
                    icon.classList.add('fa-volume-up');
                }
            } else {
                audio.pause();
            }
            localStorage.setItem('audioPaused', audio.paused.toString());
            updatePlayButton();
        };

        const seekTo = (pct) => {
            if (audio.duration) {
                audio.currentTime = (pct / 100) * audio.duration;
            }
        };

        window.crossfadeToTheme = crossfadeToTheme;
        window.audioCrossfadeDuration = crossfadeDuration;
        window.nextTrack = nextTrack;
        window.prevTrack = prevTrack;
        window.togglePlay = togglePlay;
        window.seekAudio = seekTo;

        loadAndResume();
        updateProgress();

        audio.muted = storedMuted;
        if (icon) {
            icon.classList.toggle('fa-volume-mute', storedMuted);
            icon.classList.toggle('fa-volume-up', !storedMuted);
        }
        
        function updateProgress() {
            if (!progressBar) {
                progressBar = document.getElementById('audio-progress');
                if (progressBar) {
                    progressBar.addEventListener('input', function () {
                        seekTo(parseFloat(this.value));
                    });
                }
            }
            if (!timeDisplay) {
                timeDisplay = document.getElementById('audio-remaining');
            }
            if (progressBar && audio.duration) {
                const pct = (audio.currentTime / audio.duration) * 100;
                progressBar.value = pct;
                progressBar.style.setProperty('--audio-progress-value', pct + '%');
                progressBar.style.background =
                    `linear-gradient(to right, ${primaryColor} ${pct}%, rgba(${primaryRgb}, 0.2) ${pct}%)`;
            }
            if (timeDisplay && audio.duration) {
                if (showRemaining) {
                    const remaining = Math.max(0, audio.duration - audio.currentTime);
                    timeDisplay.textContent = '-' + formatTime(remaining);
                } else {
                    timeDisplay.textContent = formatTime(audio.currentTime);
                }
            }
        }

        const timeUpdateHandler = () => {
            localStorage.setItem('audioPlaybackTime', audio.currentTime);
            updateProgress();
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

        const onTrackEnded = () => {
            trackIndex = (trackIndex + 1) % playlist.length;
            loadTrack(audio, trackIndex);
            loadTrack(nextAudio, (trackIndex + 1) % playlist.length);
            storedTime = 0;
            loadAndResume();
            updateProgress();
        };

        if (playlist.length > 1) {
            audio.addEventListener('ended', onTrackEnded);
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', function () {
                const volume = parseInt(this.value, 10) / 100;
                baseVolume = volume;
                audio.volume = volume;
                nextAudio.volume = volume;
                localStorage.setItem('audioVolume', volume.toString());
                updateVolumeSliderStyle();
            });
        }

        if (playBtn) {
            playBtn.addEventListener('click', togglePlay);
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', prevTrack);
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', nextTrack);
        }

        if (progressBar) {
            progressBar.addEventListener('input', function () {
                seekTo(parseFloat(this.value));
            });
        }

        if (timeDisplay) {
            timeDisplay.addEventListener('click', function () {
                showRemaining = !showRemaining;
                updateProgress();
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
