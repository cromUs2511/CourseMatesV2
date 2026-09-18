"""Native acceleration boundary for Python orchestration.

Production containers install the C++ wheel from `native/`. Local development
can use the deterministic fallback solely for parity tests.
"""

try:
    import coursemates_native as _native
except ImportError:  # Local tests may run before a compiler toolchain is installed.
    _native = None


def normalize_for_match(value: str) -> str:
    """Use C++ Unicode normalization when available, with a test fallback."""
    if _native is not None:
        return _native.normalize_text(value, squashed=False)
    return value.lower()


def native_status() -> dict[str, object]:
    return {
        "available": _native is not None,
        "implementation": "c++" if _native is not None else "python-test-fallback",
        "version": getattr(_native, "__version__", None),
    }
