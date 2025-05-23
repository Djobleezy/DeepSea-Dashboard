from pathlib import Path


def test_volume_slider_vertical():
    css_path = Path("static/css/common.css")
    assert css_path.exists()
    content = css_path.read_text()
    assert "writing-mode: vertical-lr" in content
    assert "direction: rtl" in content


def test_volume_slider_desktop_only_and_position():
    """Ensure the volume slider styles are correct for desktop only and above the icon."""
    css_path = Path("static/css/common.css")
    content = css_path.read_text()
    assert "flex-direction: column-reverse" in content
    assert "@media (max-width: 599px)" in content


def test_volume_slider_uses_accent_color():
    """Slider should adopt the current theme accent color."""
    css_path = Path("static/css/common.css")
    content = css_path.read_text()
    assert "accent-color: var(--accent-color)" in content
    assert "rgba(var(--accent-color-rgb), 0.5)" in content
