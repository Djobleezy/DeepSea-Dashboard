import subprocess
import shutil
from pathlib import Path

import minify


def test_run_postcss_called(monkeypatch, tmp_path):
    css_dir = tmp_path / "static/css"
    css_dir.mkdir(parents=True)
    css_file = css_dir / "style.css"
    css_file.write_text("a { display: flex }", encoding="utf-8")

    called = {}

    def fake_which(cmd):
        return "/usr/bin/" + cmd

    def fake_run(cmd, check=True):
        called["cmd"] = cmd

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(shutil, "which", fake_which)
    monkeypatch.setattr(subprocess, "run", fake_run)

    out_dir = minify.run_postcss()
    assert (out_dir / "style.css")
    assert called["cmd"][0].endswith("postcss")


def test_minify_html_string():
    html = "<div> <!--c--> <p class=\"\"> a  b </p> </div>"
    result = minify.minify_html_string(html)
    assert "<!--" not in result
    assert "  " not in result
    assert 'class=""' not in result
    assert result == "<div><p class>a b</p></div>"

