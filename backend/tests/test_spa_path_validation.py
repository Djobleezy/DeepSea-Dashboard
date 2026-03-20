"""Unit tests for the SPA fallback path-validation helper.

Exercises resolve_spa_path() directly, without mounting the full FastAPI app,
to verify that traversal, absolute-path, Windows drive-letter/UNC, and
backslash inputs are all properly rejected.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.main import resolve_spa_path


@pytest.fixture
def dist_root(tmp_path: Path) -> Path:
    """Create a minimal fake frontend/dist directory with a test file."""
    (tmp_path / "index.html").write_text("<html></html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "main.js").write_text("// js")
    return tmp_path


# ---- Valid paths ---------------------------------------------------------

class TestValidPaths:
    def test_simple_file(self, dist_root: Path):
        result = resolve_spa_path("index.html", dist_root)
        assert result is not None
        assert result == (dist_root / "index.html").resolve()

    def test_nested_file(self, dist_root: Path):
        result = resolve_spa_path("assets/main.js", dist_root)
        assert result is not None
        assert result == (dist_root / "assets" / "main.js").resolve()

    def test_nonexistent_file_returns_path(self, dist_root: Path):
        """resolve_spa_path returns the resolved path even if the file doesn't
        exist — the caller checks .is_file() separately."""
        result = resolve_spa_path("no-such-file.txt", dist_root)
        assert result is not None


# ---- Empty / root path ---------------------------------------------------

class TestEmptyPath:
    def test_empty_string_returns_none(self, dist_root: Path):
        assert resolve_spa_path("", dist_root) is None


# ---- Traversal -----------------------------------------------------------

class TestTraversal:
    def test_dot_dot_simple(self, dist_root: Path):
        assert resolve_spa_path("../etc/passwd", dist_root) is None

    def test_dot_dot_middle(self, dist_root: Path):
        assert resolve_spa_path("assets/../../etc/passwd", dist_root) is None

    def test_dot_dot_encoded_not_our_job(self, dist_root: Path):
        """URL-encoded traversal (%2e%2e) is decoded by the web framework
        before it reaches us, so we don't need to handle it — but we do
        reject literal '..' components."""
        assert resolve_spa_path("..", dist_root) is None


# ---- Backslash inputs (Windows traversal) --------------------------------

class TestBackslash:
    def test_backslash_traversal(self, dist_root: Path):
        assert resolve_spa_path("..\\secret.txt", dist_root) is None

    def test_backslash_in_middle(self, dist_root: Path):
        assert resolve_spa_path("assets\\..\\..\\etc\\passwd", dist_root) is None

    def test_single_backslash(self, dist_root: Path):
        assert resolve_spa_path("foo\\bar", dist_root) is None


# ---- Absolute paths (POSIX) ----------------------------------------------

class TestAbsolutePosix:
    def test_leading_slash(self, dist_root: Path):
        assert resolve_spa_path("/etc/passwd", dist_root) is None


# ---- Windows drive letters -----------------------------------------------

class TestWindowsDrive:
    def test_drive_letter_upper(self, dist_root: Path):
        assert resolve_spa_path("C:/Windows/System32/cmd.exe", dist_root) is None

    def test_drive_letter_lower(self, dist_root: Path):
        assert resolve_spa_path("c:/index.html", dist_root) is None

    def test_drive_letter_no_slash(self, dist_root: Path):
        assert resolve_spa_path("D:index.html", dist_root) is None


# ---- UNC paths -----------------------------------------------------------

class TestUNC:
    def test_unc_path(self, dist_root: Path):
        assert resolve_spa_path("//server/share/file", dist_root) is None

    def test_double_slash_relative(self, dist_root: Path):
        assert resolve_spa_path("//anything", dist_root) is None
