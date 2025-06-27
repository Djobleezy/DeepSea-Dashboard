import importlib
import io
import gc


def test_history_csv_functions_close_stringio():
    App = importlib.reload(importlib.import_module("App"))
    history = {"hashrate": [{"time": "t", "value": 1, "arrow": "", "unit": "th/s"}]}
    metrics_log = [{"timestamp": "t", "metrics": {"hashrate": 1}}]
    gc.collect()
    before = sum(1 for obj in gc.get_objects() if isinstance(obj, io.StringIO))
    for _ in range(3):
        h_csv = App.arrow_history_to_csv(history)
        m_csv = App.metrics_log_to_csv(metrics_log)
        assert "hashrate" in h_csv
        assert "timestamp" in m_csv
    gc.collect()
    after = sum(1 for obj in gc.get_objects() if isinstance(obj, io.StringIO))
    assert before == after

