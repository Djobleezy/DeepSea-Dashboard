from unittest.mock import MagicMock
from datetime import datetime
from zoneinfo import ZoneInfo
import sys
import types
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

if 'pytz' not in sys.modules:
    tz_module = types.ModuleType('pytz')
    class DummyTZInfo:
        def utcoffset(self, dt):
            return None
        def dst(self, dt):
            return None
        def tzname(self, dt):
            return 'UTC'
        def localize(self, dt_obj):
            return dt_obj.replace(tzinfo=self)
    tz_module.timezone = lambda name: DummyTZInfo()
    sys.modules['pytz'] = tz_module

if 'requests' not in sys.modules:
    req_module = types.ModuleType('requests')
    class DummySession:
        def get(self, *args, **kwargs):
            raise NotImplementedError
    req_module.Session = DummySession
    req_module.exceptions = types.SimpleNamespace(Timeout=Exception, ConnectionError=Exception)
    sys.modules['requests'] = req_module

if 'bs4' not in sys.modules:
    bs4_module = types.ModuleType('bs4')
    class DummySoup:
        pass
    bs4_module.BeautifulSoup = DummySoup
    sys.modules['bs4'] = bs4_module

from worker_service import WorkerService
from data_service import MiningDashboardService
from notification_service import NotificationService
import data_service


def test_generate_default_workers_data(monkeypatch):
    monkeypatch.setattr('worker_service.get_timezone', lambda: 'UTC')
    svc = WorkerService()
    data = svc.generate_default_workers_data()
    assert data['workers_total'] == 0
    assert data['hashrate_unit'] == 'TH/s'
    assert data['workers'] == []


def test_fetch_url_success(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')
    resp = MagicMock()
    monkeypatch.setattr(svc.session, 'get', lambda url, timeout=5: resp)
    assert svc.fetch_url('http://x') is resp


def test_fetch_url_error(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')
    def fail(url, timeout=5):
        raise Exception('fail')
    monkeypatch.setattr(svc.session, 'get', fail)
    assert svc.fetch_url('http://x') is None


def test_notification_update_currency(monkeypatch):
    class DummyState:
        def get_notifications(self):
            return []
        def save_notifications(self, n):
            self.saved = n
            return True
    state = DummyState()
    svc = NotificationService(state)
    svc.notifications = [{
        'id': '1',
        'timestamp': '2023-01-01T00:00:00',
        'message': 'profit ($10.00)',
        'level': 'info',
        'category': 'hashrate',
        'data': {'daily_profit': 10.0, 'currency': 'USD'}
    }]
    monkeypatch.setattr('notification_service.get_exchange_rates', lambda: {'EUR': 0.5, 'USD':1})
    updated = svc.update_notification_currency('EUR')
    assert updated == 1
    notif = svc.notifications[0]
    assert notif['data']['currency'] == 'EUR'
    assert abs(notif['data']['daily_profit'] - 5.0) < 1e-6


def test_exchange_rate_caching(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    fake_time = [0]
    monkeypatch.setattr(data_service.time, 'time', lambda: fake_time[0])

    call_count = {'count': 0}

    def fake_get(url, timeout=5):
        call_count['count'] += 1
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = {
            'result': 'success',
            'conversion_rates': {'EUR': 0.5, 'USD': 1}
        }
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)

    rates1 = svc.fetch_exchange_rates()
    assert rates1['EUR'] == 0.5
    assert call_count['count'] == 1

    fake_time[0] += 1000  # within TTL
    rates2 = svc.fetch_exchange_rates()
    assert rates2 == rates1
    assert call_count['count'] == 1

    fake_time[0] += svc.exchange_rate_ttl + 1  # expire cache
    rates3 = svc.fetch_exchange_rates()
    assert rates3 == rates1
    assert call_count['count'] == 2


def test_get_payment_history_api_nested_result(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    sample = {
        'result': {
            'payouts': [
                {
                    'ts': 1700000000,
                    'on_chain_txid': 'abcd',
                    'lightning_txid': 'ln1',
                    'total_satoshis_net_paid': 100
                }
            ]
        }
    }

    def fake_get(url, timeout=10):
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = sample
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')

    payments = svc.get_payment_history_api(days=1, btc_price=20000)

    assert len(payments) == 1
    p = payments[0]
    assert p['txid'] == 'abcd'
    assert p['lightning_txid'] == 'ln1'
    assert p['amount_sats'] == 100
    assert abs(p['amount_btc'] - 100 / svc.sats_per_btc) < 1e-9
    assert p['fiat_value'] == (100 / svc.sats_per_btc) * 20000
    expected_dt = datetime.fromtimestamp(1700000000, tz=ZoneInfo('UTC'))
    assert p['date_iso'] == expected_dt.isoformat()
    assert p['date'] == expected_dt.strftime('%Y-%m-%d %H:%M')


def test_get_earnings_data_with_nested_result(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    sample = {
        'result': {
            'payouts': [
                {
                    'ts': 1700000000,
                    'on_chain_txid': 'abcd',
                    'lightning_txid': 'ln1',
                    'total_satoshis_net_paid': 100
                }
            ]
        }
    }

    def fake_get(url, timeout=10):
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = sample
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')
    monkeypatch.setattr('config.get_currency', lambda: 'USD')
    monkeypatch.setattr(svc, 'get_ocean_data', lambda: data_service.OceanData())
    monkeypatch.setattr(svc, 'get_bitcoin_stats', lambda: (0, 0, 20000, 0))

    data = svc.get_earnings_data()

    assert len(data['payments']) == 1
    assert data['payments'][0]['txid'] == 'abcd'
    assert data['payments'][0]['lightning_txid'] == 'ln1'
    assert data['total_paid_btc'] == 100 / svc.sats_per_btc


def test_get_payment_history_scrape(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    html = """
    <table><tbody id='payouts-tablerows'>
    <tr class='table-row'>
        <td class='table-cell'>2025-05-01 00:00</td>
        <td class='table-cell'>abcd</td>
        <td class='table-cell'>0.00000100 BTC</td>
    </tr>
    </tbody></table>
    """

    html_empty = "<table><tbody id='payouts-tablerows'></tbody></table>"

    def fake_get(url, headers=None, timeout=10):
        resp = MagicMock()
        resp.ok = True
        if 'ppage=0' in url:
            resp.text = html
        else:
            resp.text = html_empty
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')
    import importlib, sys
    sys.modules.pop('bs4', None)
    real_bs4 = importlib.import_module('bs4')
    monkeypatch.setattr(data_service, 'BeautifulSoup', real_bs4.BeautifulSoup)

    payments = svc.get_payment_history_scrape(btc_price=20000)
    assert len(payments) == 1
    p = payments[0]
    assert p['txid'] == 'abcd'
    assert p['amount_sats'] == 100
    assert p['fiat_value'] == (100 / svc.sats_per_btc) * 20000


def test_get_payment_history_scrape_lightning(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    html = """
    <table><tbody id='payouts-tablerows'>
    <tr class='table-row'>
        <td class='table-cell'>2025-05-01 00:00</td>
        <td class='table-cell'><a href='/info/tx/lightning/ln1'>⚡ ln1</a></td>
        <td class='table-cell'>0.00000100 BTC</td>
    </tr>
    </tbody></table>
    """

    html_empty = "<table><tbody id='payouts-tablerows'></tbody></table>"

    def fake_get(url, headers=None, timeout=10):
        resp = MagicMock()
        resp.ok = True
        if 'ppage=0' in url:
            resp.text = html
        else:
            resp.text = html_empty
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')
    import importlib, sys
    sys.modules.pop('bs4', None)
    real_bs4 = importlib.import_module('bs4')
    monkeypatch.setattr(data_service, 'BeautifulSoup', real_bs4.BeautifulSoup)

    payments = svc.get_payment_history_scrape()
    assert len(payments) == 1
    p = payments[0]
    assert p['txid'] == ''
    assert p['lightning_txid'] == 'ln1'


def test_get_payment_history_scrape_pagination(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    html0 = """
    <table><tbody id='payouts-tablerows'>
    <tr class='table-row'>
        <td class='table-cell'>2025-05-01 00:00</td>
        <td class='table-cell'>tx1</td>
        <td class='table-cell'>0.00000100 BTC</td>
    </tr>
    </tbody></table>
    """

    html1 = """
    <table><tbody id='payouts-tablerows'>
    <tr class='table-row'>
        <td class='table-cell'>2025-04-30 00:00</td>
        <td class='table-cell'>tx2</td>
        <td class='table-cell'>0.00000200 BTC</td>
    </tr>
    </tbody></table>
    """

    html_empty = "<table><tbody id='payouts-tablerows'></tbody></table>"

    def fake_get(url, headers=None, timeout=10):
        resp = MagicMock()
        resp.ok = True
        if 'ppage=0' in url:
            resp.text = html0
        elif 'ppage=1' in url:
            resp.text = html1
        else:
            resp.text = html_empty
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')
    import importlib, sys
    sys.modules.pop('bs4', None)
    real_bs4 = importlib.import_module('bs4')
    monkeypatch.setattr(data_service, 'BeautifulSoup', real_bs4.BeautifulSoup)

    payments = svc.get_payment_history_scrape()
    assert len(payments) == 2
    assert payments[0]['txid'] == 'tx1'
    assert payments[1]['txid'] == 'tx2'


def test_get_earnings_data_fallback_to_scrape(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    monkeypatch.setattr(svc, 'get_payment_history_api', lambda days=360, btc_price=None: [])
    sample = [{
        'date': '2025-05-01 00:00',
        'txid': 'abcd',
        'amount_btc': 0.000001,
        'amount_sats': 100,
        'status': 'confirmed',
        'date_iso': '2025-05-01T00:00:00+00:00'
    }]
    monkeypatch.setattr(svc, 'get_payment_history_scrape', lambda btc_price=None: sample)
    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')
    monkeypatch.setattr('config.get_currency', lambda: 'USD')
    monkeypatch.setattr(svc, 'get_ocean_data', lambda: data_service.OceanData())
    monkeypatch.setattr(svc, 'get_bitcoin_stats', lambda: (0, 0, 20000, 0))

    data = svc.get_earnings_data()
    assert len(data['payments']) == 1
    assert data['payments'][0]['txid'] == 'abcd'


def test_get_worker_data_api(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    sample = {
        'workers': {
            'rig1': {'hashrate_60s': 100, 'hashrate_3600': 1000},
            'rig2': {'hashrate_60s': 0, 'hashrate_3600': 0},
        }
    }

    def fake_get(url, timeout=10):
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = sample
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')

    data = svc.get_worker_data_api()

    assert data['workers_total'] == 2
    assert data['workers_online'] == 1
    names = {w['name'] for w in data['workers']}
    assert 'rig1' in names and 'rig2' in names


def test_get_pool_stat_api(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    sample = {
        'hashrate_60s': 1000,
        'workers': 5,
        'blocks': 10
    }

    def fake_get(url, timeout=10):
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = sample
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    data = svc.get_pool_stat_api()

    assert data['workers_hashing'] == 5
    assert data['blocks_found'] == 10
    assert data['pool_total_hashrate'] == 1000


def test_get_blocks_api(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    sample = {'blocks': [{'height': 100, 'time': 1700000000}]}

    def fake_get(url, timeout=10):
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = sample
        return resp

    monkeypatch.setattr(svc.session, 'get', fake_get)
    blocks = svc.get_blocks_api()

    assert isinstance(blocks, list)
    assert blocks[0]['height'] == 100


def test_fetch_metrics_estimates_power(monkeypatch):
    class DummyWS:
        def get_workers_data(self, cached_metrics, force_refresh=False):
            return {"workers": [
                {"power_consumption": 1000},
                {"power_consumption": 1500}
            ]}

    svc = MiningDashboardService(0, 0, 'w', worker_service=DummyWS())

    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')
    monkeypatch.setattr(svc, 'get_ocean_data', lambda: data_service.OceanData(hashrate_3hr=100, hashrate_3hr_unit='TH/s', pool_fees_percentage=0.0))
    monkeypatch.setattr(svc, 'get_bitcoin_stats', lambda: (0, 100e18, 50000, 0))

    metrics = svc.fetch_metrics()

    assert metrics['daily_power_cost'] == 4.2
    assert metrics['power_usage_estimated'] is True


def test_fetch_metrics_power_configured(monkeypatch):
    class DummyWS:
        def get_workers_data(self, cached_metrics, force_refresh=False):
            return {"workers": [{"power_consumption": 1000}]}

    svc = MiningDashboardService(0, 2000, 'w', worker_service=DummyWS())

    monkeypatch.setattr('data_service.get_timezone', lambda: 'UTC')
    monkeypatch.setattr(svc, 'get_ocean_data', lambda: data_service.OceanData(hashrate_3hr=100, hashrate_3hr_unit='TH/s', pool_fees_percentage=0.0))
    monkeypatch.setattr(svc, 'get_bitcoin_stats', lambda: (0, 100e18, 50000, 0))

    metrics = svc.fetch_metrics()

    assert metrics['power_usage_estimated'] is False


