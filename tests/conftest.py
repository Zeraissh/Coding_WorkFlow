# tests/conftest.py - Shared fixtures and configuration for pytest

import sys
import os
import pytest
import threading
import tempfile
from unittest.mock import MagicMock, patch

# Ensure the project root is on the Python path so imports work.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# General-purpose fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def temp_dir():
    """A temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def mock_serial():
    """Return a MagicMock that resembles a pySerial ``Serial`` object."""
    ser = MagicMock()
    ser.read.return_value = b""
    ser.write.return_value = None
    ser.in_waiting = 0
    ser.is_open = True
    ser.baudrate = 9600
    ser.port = "COM1"
    return ser


# ---------------------------------------------------------------------------
# Fixtures for virtual_serial module tests
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_virtual_serial_state():
    """Reset the module-level state of virtual_serial before each test."""
    import virtual_serial as vs
    # Stop and clear forwarding threads
    for t, stop_event, fd in vs._forwarding_threads:
        stop_event.set()
        t.join(timeout=1.0)
    vs._forwarding_threads.clear()
    # Close master FDs
    for fd in vs._unix_master_fds:
        try:
            os.close(fd)
        except OSError:
            pass
    vs._unix_master_fds.clear()
    # Terminate subprocesses
    vs._cleanup_subprocesses()
    yield


@pytest.fixture
def mock_pty(monkeypatch):
    """Mock the ``pty.openpty`` and related functions for Unix PTY tests."""
    import virtual_serial as vs

    # Create real pipe pairs to simulate PTY behavior
    import os as _os
    r1, w1 = _os.pipe()
    r2, w2 = _os.pipe()

    call_count = [0]

    def fake_openpty():
        call_count[0] += 1
        if call_count[0] == 1:
            return r1, w1
        else:
            return r2, w2

    def fake_ttyname(fd):
        if fd == w1:
            return "/dev/pts/10"
        elif fd == w2:
            return "/dev/pts/11"
        return "/dev/pts/unknown"

    monkeypatch.setattr(vs.pty, "openpty", fake_openpty)
    monkeypatch.setattr(vs.os, "ttyname", fake_ttyname)

    # Mock _configure_raw and _set_nonblocking to avoid real termios/fcntl calls
    monkeypatch.setattr(vs, "_configure_raw", lambda fd: None)
    monkeypatch.setattr(vs, "_set_nonblocking", lambda fd: None)

    yield {"r1": r1, "w1": w1, "r2": r2, "w2": w2, "call_count": call_count}

    # Cleanup
    for fd in [r1, w1, r2, w2]:
        try:
            _os.close(fd)
        except OSError:
            pass
