#!/usr/bin/env python3
"""Minimal asset minification helper."""

import subprocess
import shutil
import logging
from pathlib import Path
import re

from cssmin import cssmin

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def _has_uglify():
    return shutil.which("uglifyjs") is not None


def minify_html_string(html: str) -> str:
    """Return a minified HTML string."""
    html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)
    html = re.sub(r"\s+(\w+)=\"\"", r" \1", html)
    html = re.sub(r">\s+<", "><", html)
    html = re.sub(r">\s+", ">", html)
    html = re.sub(r"\s+<", "<", html)
    html = re.sub(r"\s{2,}", " ", html)
    return html.strip()


def run_postcss() -> Path:
    """Run PostCSS with Autoprefixer on CSS files if available.

    Returns the directory containing processed files. If PostCSS is not
    installed, the original CSS directory is returned unchanged.
    """

    css_dir = Path("static/css")
    out_dir = css_dir / "prefixed"
    out_dir.mkdir(parents=True, exist_ok=True)

    postcss_cmd = None
    if shutil.which("postcss"):
        postcss_cmd = ["postcss"]
    elif shutil.which("npx"):
        postcss_cmd = ["npx", "postcss"]

    if not postcss_cmd:
        logger.warning("PostCSS not available; skipping prefixing")
        return css_dir

    for src in css_dir.glob("*.css"):
        if src.name.endswith(".min.css"):
            continue
        out = out_dir / src.name
        subprocess.run(postcss_cmd + [str(src), "-o", str(out)], check=True)
        logger.info("PostCSS processed %s", src.name)

    return out_dir


def minify_js():
    """Minify JS files using uglify-js if available or jsmin fallback."""
    js_dir = Path("static/js")
    out_dir = js_dir / "min"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        from jsmin import jsmin  # fallback
    except Exception:
        jsmin = None

    for src in js_dir.glob("*.js"):
        if src.name.endswith(".min.js"):
            continue
        out = out_dir / src.name.replace(".js", ".min.js")
        if _has_uglify():
            subprocess.run(["uglifyjs", str(src), "-c", "-m", "-o", str(out)], check=True)
        elif jsmin:
            out.write_text(jsmin(src.read_text()), encoding="utf-8")
        else:
            logger.warning("No JS minifier available for %s", src.name)
            continue
        logger.info("Minified %s", src.name)


def minify_css():
    """Run PostCSS then minify CSS files using cssmin."""
    css_dir = Path("static/css")
    prefixed_dir = run_postcss()
    out_dir = css_dir / "min"
    out_dir.mkdir(parents=True, exist_ok=True)

    for src in prefixed_dir.glob("*.css"):
        if src.name.endswith(".min.css"):
            continue
        out = out_dir / src.name.replace(".css", ".min.css")
        out.write_text(cssmin(src.read_text()), encoding="utf-8")
        logger.info("Minified %s", src.name)


def minify_html():
    """Minify HTML templates."""
    tmpl_dir = Path("templates")
    out_dir = tmpl_dir / "min"
    out_dir.mkdir(parents=True, exist_ok=True)

    for src in tmpl_dir.glob("*.html"):
        if src.name.endswith(".min.html"):
            continue
        out = out_dir / src.name.replace(".html", ".min.html")
        out.write_text(minify_html_string(src.read_text()), encoding="utf-8")
        logger.info("Minified %s", src.name)


def main():
    """Command-line entry point for asset minification."""
    import argparse

    parser = argparse.ArgumentParser(description="Minify static assets")
    parser.add_argument("--js", action="store_true", help="minify JavaScript")
    parser.add_argument("--css", action="store_true", help="minify CSS")
    parser.add_argument("--html", action="store_true", help="minify HTML")
    parser.add_argument("--all", action="store_true", help="minify all (default)")
    args = parser.parse_args()

    if not any([args.js, args.css, args.html, args.all]):
        args.all = True

    if args.all or args.js:
        minify_js()
    if args.all or args.css:
        minify_css()
    if args.all or args.html:
        minify_html()


if __name__ == "__main__":
    main()
