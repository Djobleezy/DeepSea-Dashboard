# Simple helper tasks for development

PYTHON=python3

setup:
	$(PYTHON) setup.py

minify:
	$(PYTHON) minify.py --all

minify-js:
	$(PYTHON) minify.py --js

minify-css:
	$(PYTHON) minify.py --css

minify-html:
	$(PYTHON) minify.py --html

.PHONY: setup minify minify-js minify-css minify-html
