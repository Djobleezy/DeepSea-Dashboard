## ✨ v{VERSION} – {TITLE}

**Full Changelog**: https://github.com/Djobleezy/DeepSea-Dashboard/compare/v{PREV}...v{VERSION}

### 🆕 What's New
- 

### 🐛 Bug Fixes
- 

### 🔐 Security
- 

### 📦 Packaging Notes (Start9 / Umbrel)
- **Breaking:** None — drop-in update
- **Config:** No schema changes
- **Ports:** Still 8000 (unchanged)
- **Env vars:** None added/removed
- **Docker:** No entrypoint changes

---

### Usage

GitHub auto-generates changelogs from PR labels via `.github/release.yml`.
This template adds the **Packaging Notes** section for downstream packagers (Start9, Umbrel).

```bash
# Create a release using this template as a starting point:
gh release create v2.x.x --generate-notes --notes-file .github/RELEASE_TEMPLATE.md --draft
```

Edit the draft on GitHub to fill in version-specific details before publishing.
