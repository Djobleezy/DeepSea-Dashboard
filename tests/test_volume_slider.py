from pathlib import Path

def test_volume_slider_vertical():
    css_path = Path("static/css/common.css")
    assert css_path.exists()
    content = css_path.read_text()
    assert "slider-vertical" in content
    assert "writing-mode: bt-lr" in content
