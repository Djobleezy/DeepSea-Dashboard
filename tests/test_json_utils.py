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


def test_convert_deques_nested_dict():
    """Test nested dictionaries with deques."""
    data = {
        "outer": {
            "inner": deque([4, 5, 6]),
            "normal": [7, 8, 9]
        }
    }
    converted = convert_deques(data)
    assert converted == {
        "outer": {
            "inner": [4, 5, 6],
            "normal": [7, 8, 9]
        }
    }


def test_convert_deques_nested_list():
    """Test lists containing deques."""
    data = [deque([1, 2]), {"nested": deque([3, 4])}, "string"]
    converted = convert_deques(data)
    assert converted == [[1, 2], {"nested": [3, 4]}, "string"]


def test_convert_deques_primitive_values():
    """Test that primitive values are returned unchanged."""
    assert convert_deques(42) == 42
    assert convert_deques("string") == "string"
    assert convert_deques(None) is None
    assert convert_deques(True) is True
