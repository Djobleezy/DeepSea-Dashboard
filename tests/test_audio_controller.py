from pathlib import Path


def test_audio_controller_ids_present():
    js_path = Path("static/js/BitcoinProgressBar.js")
    content = js_path.read_text()
    assert "audio-progress" in content
    assert "audio-prev" in content
    assert "audio-next" in content
    assert "audio-play" in content
    assert "audio-remaining" in content


def test_audio_controller_functions():
    js_path = Path("static/js/audio.js")
    content = js_path.read_text()
    assert "window.nextTrack" in content
    assert "window.prevTrack" in content
    assert "window.togglePlay" in content
    assert "window.seekAudio" in content
