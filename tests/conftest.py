# tests/conftest.py - Shared fixtures and configuration for pytest

import sys
import os
import pytest
import threading
import tempfile
import subprocess
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


@pytest.fixture
def mock_serials(monkeypatch):
    """Mock both serial.Serial instances and patch serial_bridge.serial.Serial."""
    import serial_bridge as sb

    mock_ser1 = MagicMock()
    mock_ser1.is_open = True
    mock_ser1.read.return_value = b""
    mock_ser1.in_waiting = 0

    mock_ser2 = MagicMock()
    mock_ser2.is_open = True
    mock_ser2.read.return_value = b""
    mock_ser2.in_waiting = 0

    # Patch the serial module used by serial_bridge
    monkeypatch.setattr(sb.serial, "Serial", MagicMock(side_effect=[mock_ser1, mock_ser2]))

    return mock_ser1, mock_ser2


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
    """Mock the ``pty.openpty`` and related functions for Unix PTY tests.

    Because ``pty`` is imported locally inside ``_create_unix_pair_with_pty``,
    we monkeypatch ``virtual_serial._create_unix_pair_with_pty`` directly to
    return fake port names and set up real pipe pairs for data forwarding tests.
    """
    import virtual_serial as vs

    # Create real pipe pairs to simulate PTY behavior
    r1, w1 = os.pipe()
    r2, w2 = os.pipe()

    call_count = [0]

    def fake_create_unix_pair_with_pty():
        """Simulate successful PTY pair creation."""
        call_count[0] += 1

        # Track FDs for cleanup
        vs._unix_master_fds.extend([r1, r2])

        # Set non-blocking on pipes (best-effort on Windows)
        try:
            import fcntl
            for fd in (r1, r2):
                flags = fcntl.fcntl(fd, fcntl.F_GETFL)
                fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        except (ImportError, OSError):
            pass

        # Spawn forwarding threads
        stop_event1 = threading.Event()
        stop_event2 = threading.Event()

        t1 = threading.Thread(
            target=vs._forward,
            args=(r1, r2, stop_event1),
            daemon=True,
            name="virtual-serial-fwd-1",
        )
        t2 = threading.Thread(
            target=vs._forward,
            args=(r2, r1, stop_event2),
            daemon=True,
            name="virtual-serial-fwd-2",
        )

        vs._forwarding_threads.append((t1, stop_event1, r1))
        vs._forwarding_threads.append((t2, stop_event2, r2))

        t1.start()
        t2.start()

        return "/dev/pts/10", "/dev/pts/11"

    monkeypatch.setattr(vs, "_create_unix_pair_with_pty", fake_create_unix_pair_with_pty)

    yield {"r1": r1, "w1": w1, "r2": r2, "w2": w2, "call_count": call_count}

    # Cleanup
    for fd in [r1, w1, r2, w2]:
        try:
            os.close(fd)
        except OSError:
            pass
