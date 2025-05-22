# Testing Guide

This project uses [pytest](https://docs.pytest.org/) for unit tests. To execute the test suite, run:

```bash
pytest
```

## What Not to Test

- **Long-running integrations and external APIs** are replaced with mocks during testing. This ensures that automated tests remain fast and do not rely on external services.
- **UI and animation behaviors** are verified manually. Automated tests focus on backend logic and API responses, not visual effects.

