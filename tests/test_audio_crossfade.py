from pathlib import Path
import re


def test_crossfade_constant():
    js_path = Path("static/js/audio.js")
    assert js_path.exists()
    content = js_path.read_text()
    assert "crossfadeDuration" in content
    assert re.search(r"crossfadeDuration\s*=\s*2", content)


def test_crossfade_to_theme_function():
    js_path = Path("static/js/audio.js")
    content = js_path.read_text()
    assert "crossfadeToTheme" in content
    assert "window.crossfadeToTheme" in content
