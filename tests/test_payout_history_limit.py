import importlib
import state_manager


def test_save_payout_history_prunes(monkeypatch):
    App = importlib.reload(importlib.import_module('App'))
    mgr = App.state_manager
    long_history = [{"id": i} for i in range(state_manager.MAX_PAYOUT_HISTORY_ENTRIES + 5)]
    mgr.save_payout_history(long_history)
    assert len(mgr.get_payout_history()) == state_manager.MAX_PAYOUT_HISTORY_ENTRIES
