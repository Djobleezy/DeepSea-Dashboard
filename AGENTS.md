# Guidelines for Codex Agents

This repository contains a Python/Flask dashboard with JavaScript and CSS assets. When updating code, follow these rules:

## Coding style
- Use **4 spaces** for indentation and avoid tabs.
- Limit line length to **120 characters**.
- Document public functions and classes with docstrings.
- Use `snake_case` for functions and variables and `PascalCase` for classes.

## Development workflow
- Add or update **pytest** tests under `tests/` when modifying Python code.
- Install dependencies with:
  ```bash
  pip install -r requirements.txt
  ```
- Run tests before committing with:
  ```bash
  PYTHONPATH=$PWD pytest
  ```
- If you modify files in `static/` or `templates/`, run `make minify` to regenerate minified assets.
- Use `make setup` to organize directories when the structure changes.

## Repository notes
- The main application entry point is `App.py`.
- Configuration lives in `config.py` and `config.json`.
- Documentation resides in the `docs/` folder. Update relevant docs when adding new features.
- Target Python version is **3.9+**.

