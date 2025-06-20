import importlib
import io
import gc


def test_payments_to_csv_closes_stringio():
    earnings_routes = importlib.reload(importlib.import_module("earnings_routes"))
    payments = [
        {"date": "2024-01-01", "txid": "tx", "lightning_txid": "", "amount_btc": 0.1, "amount_sats": 10000000, "status": "confirmed"}
    ]
    gc.collect()
    before = sum(1 for obj in gc.get_objects() if isinstance(obj, io.StringIO))
    for _ in range(5):
        csv_data = earnings_routes.payments_to_csv(payments)
        assert "tx" in csv_data
    gc.collect()
    after = sum(1 for obj in gc.get_objects() if isinstance(obj, io.StringIO))
    assert before == after
