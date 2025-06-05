import weakref
import gc
from collections import deque

from json_utils import convert_deques


def test_convert_deques_basic():
    """Simple deque should be converted to list."""
    data = {"d": deque([1, 2, 3])}
    converted = convert_deques(data)
    assert converted == {"d": [1, 2, 3]}
    # Original data remains deque
    assert isinstance(data["d"], deque)


def test_convert_deques_no_reference_leak():
    """convert_deques should not retain references to input deques."""
    d = deque([1, 2, 3])
    ref = weakref.ref(d)
    result = convert_deques({"d": d})
    assert ref() is d
    # Remove strong references and collect
    del result
    del d
    gc.collect()
    assert ref() is None
