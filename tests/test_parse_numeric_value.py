import pytest

from tests.test_stubs import install_dummy_pytz, install_dummy_requests, install_dummy_bs4

install_dummy_pytz()
install_dummy_requests()
install_dummy_bs4()

from notification_service import NotificationService


class DummyState:
    def get_notifications(self):
        return []

    def save_notifications(self, notifications):
        pass


def test_parse_numeric_value_with_commas():
    svc = NotificationService(DummyState())
    assert svc._parse_numeric_value("1,234") == pytest.approx(1234)
    assert svc._parse_numeric_value("-2,000.5 TH/s") == pytest.approx(-2000.5)


def test_parse_numeric_value_without_space():
    svc = NotificationService(DummyState())
    assert svc._parse_numeric_value("1,234.56TH/s") == pytest.approx(1234.56)
