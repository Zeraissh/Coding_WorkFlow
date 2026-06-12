#!/usr/bin/env python3
"""
virtual_serial.py - Cross-platform virtual serial port pair creation.

This module provides functionality to create virtual serial port pairs that
are connected like a null-modem cable: data written to one port can be read
from the other, and vice versa.

Supported platforms:
    - **Linux / macOS (Unix)**: Uses the built-in ``pty`` module to create
      pseudo-terminal pairs with background threads handling bidirectional
      data forwarding.  No external dependencies required.  Falls back to
      ``socat`` if ``pty`` is unavailable for any reason.
    - **Windows**: Attempts to use **com0com** (a popular open-source virtual
      serial port driver) if installed.  Falls back to **socat** if available.
      If neither is found, an exception is raised with installation
      instructions.

Example usage::

    import virtual_serial

    try:
        port1, port2 = virtual_serial.create_virtual_serial_pair()
        print(f"Virtual ports created: {port1} <-> {port2}")
        # Use port1 and port2 with serial communication libraries,
        # e.g. ``serial.Serial(port1, ...)``
    finally:
        virtual_serial.cleanup()  # terminate forwarding threads / subprocesses

    # -- or use the context manager --
    with virtual_serial.VirtualSerialPair() as (port1, port2):
        # ports are alive inside the ``with`` block
        ...
"""

from __future__ import annotations

import sys
import os
import logging
import threading
import subprocess
import shutil
import time
from typing import Optional, Tuple, Set, List

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal state – used by Unix PTY implementation to keep forwarding alive
# ---------------------------------------------------------------------------
_forwarding_threads: List[Tuple[threading.Thread, threading.Event, int]] = []
_unix_master_fds: List[int] = []

# Processes spawned as part of virtual-serial creation (e.g. socat).
_managed_subprocesses: List[subprocess.Popen] = []


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_virtual_serial_pair() -> Tuple[str, str]:
    """
    Create a pair of connected virtual serial ports.

    Data written to the first port can be read from the second port, and
    vice versa, emulating a physical null-modem cable between two serial
    ports.

    Returns
    -------
    tuple[str, str]
        A 2-tuple ``(port1, port2)`` containing the device names / paths
        of the two virtual serial ports.

    Raises
    ------
    OSError
        If the underlying OS facilities are unavailable.
    NotImplementedError
        If no suitable virtual-serial mechanism is available on the current
        platform (e.g. Windows without com0com / socat).
    RuntimeError
        If the creation process fails for any other reason.

    Notes
    -----
    On Unix the returned paths point to pseudo-terminal slave devices
    (e.g. ``/dev/pts/5``) or symlinks to them (when using socat).
    On Windows they are COM port names such as ``COM3`` or internal
    com0com device names (``CNCA0``, ``CNCB0``).

    The caller is responsible for eventually calling :func:`cleanup` to
    release operating-system resources (file descriptors, forwarding
    threads, or subprocesses).
    """
    if sys.platform in ("linux", "darwin", "cygwin"):
        return _create_unix_pair()
    elif sys.platform == "win32":
        return _create_windows_pair()
    else:
        raise NotImplementedError(
            f"Platform '{sys.platform}' is not supported."
        )


def cleanup() -> None:
    """
    Release all resources held by virtual serial port pairs created during
    this session.

    This function is idempotent – calling it multiple times is safe.
    """
    # --- Stop forwarding threads (Unix PTY) ---
    for t, stop_event, fd in _forwarding_threads:
        stop_event.set()
        try:
            t.join(timeout=2.0)
        except RuntimeError:
            pass
    for fd in _unix_master_fds:
        try:
            os.close(fd)
        except OSError:
            pass
    _forwarding_threads.clear()
    _unix_master_fds.clear()

    # --- Terminate managed subprocesses ---
    _cleanup_subprocesses()


# ---------------------------------------------------------------------------
# Unix (Linux / macOS) implementation using PTY + threading
# ---------------------------------------------------------------------------

def _create_unix_pair() -> Tuple[str, str]:
    """
    Create two pseudo-terminal pairs and bridge their master ends with
    forwarding threads so that the slave ends behave like a null-modem
    cable.

    The implementation first tries Python's built-in ``pty`` module.
    If that fails it falls back to ``socat`` (if available on ``$PATH``).
    """
    # Attempt 1: Python PTY (pure Python, no external dependencies)
    try:
        return _create_unix_pair_with_pty()
    except Exception as exc:
        logger.debug("PTY-based creation failed: %s", exc)

    # Attempt 2: socat
    ports = _create_with_socat()
    if ports is not None:
        return ports

    raise RuntimeError(
        "Failed to create virtual serial pair on Unix. "
        "Neither the built-in PTY mechanism nor socat worked. "
        "Please install socat (e.g. `apt install socat`) and retry."
    )


def _create_unix_pair_with_pty() -> Tuple[str, str]:
    """Create a virtual serial pair using ``os.openpty()`` and threads."""
    import pty

    # Create two PTY pairs.  Each call returns (master_fd, slave_fd).
    master1_fd, slave1_fd = pty.openpty()
    master2_fd, slave2_fd = pty.openpty()

    try:
        # Configure the masters as raw to avoid any kernel processing
        # (echo, canonical mode, etc.).  This makes them behave more like
        # real serial ports.
        _configure_raw(master1_fd)
        _configure_raw(master2_fd)

        # Get the filesystem names of the slave devices.
        slave1_name = os.ttyname(slave1_fd)
        slave2_name = os.ttyname(slave2_fd)
    finally:
        # Close the slave file descriptors in the parent process – we only
        # need the names; the master FDs are used for forwarding.
        os.close(slave1_fd)
        os.close(slave2_fd)

    # Set non-blocking I/O on the master FDs so the forwarding threads
    # can react to stop events quickly.
    _set_nonblocking(master1_fd)
    _set_nonblocking(master2_fd)

    # Track FDs for cleanup.
    _unix_master_fds.extend([master1_fd, master2_fd])

    # Spawn forwarding threads.
    stop_event1 = threading.Event()
    stop_event2 = threading.Event()

    t1 = threading.Thread(
        target=_forward,
        args=(master1_fd, master2_fd, stop_event1),
        daemon=True,
        name="virtual-serial-fwd-1",
    )
    t2 = threading.Thread(
        target=_forward,
        args=(master2_fd, master1_fd, stop_event2),
        daemon=True,
        name="virtual-serial-fwd-2",
    )

    _forwarding_threads.append((t1, stop_event1, master1_fd))
    _forwarding_threads.append((t2, stop_event2, master2_fd))

    t1.start()
    t2.start()

    logger.info("Unix virtual serial pair created: %s <-> %s",
                slave1_name, slave2_name)
    return slave1_name, slave2_name


def _configure_raw(fd: int) -> None:
    """
    Put the terminal referenced by *fd* into raw mode.

    Disables echo, canonical mode, signal generation, and software flow
    control so that the PTY behaves like a transparent byte pipe.
    """
    import termios

    # Get current terminal attributes.
    attrs = termios.tcgetattr(fd)

    # Modify flags for raw mode.
    # Input flags: disable special character processing.
    attrs[0] &= ~(
        termios.IGNBRK | termios.BRKINT | termios.PARMRK |
        termios.ISTRIP | termios.INLCR | termios.IGNCR |
        termios.ICRNL | termios.IXON
    )
    # Output flags: disable output processing.
    attrs[1] &= ~(termios.OPOST)
    # Control flags: set 8-bit characters.
    attrs[2] &= ~(termios.CSIZE | termios.PARENB)
    attrs[2] |= termios.CS8
    # Local flags: disable echo, canonical mode, signal chars.
    attrs[3] &= ~(
        termios.ECHO | termios.ECHONL | termios.ICANON |
        termios.ISIG | termios.IEXTEN
    )
    # Control characters: set MIN = 1, TIME = 0 (return on every byte).
    attrs[6][termios.VMIN] = 1
    attrs[6][termios.VTIME] = 0

    # Apply the modified attributes.
    termios.tcsetattr(fd, termios.TCSANOW, attrs)


def _forward(src_fd: int, dst_fd: int, stop_event: threading.Event) -> None:
    """
    Forward data from *src_fd* to *dst_fd* until *stop_event* is set.

    Runs in a dedicated daemon thread.  Uses ``select()`` with a short
    timeout so the thread can check the stop event periodically.
    """
    import select

    CHUNK = 4096  # internal buffer size – typical UART FIFO is small anyway

    while not stop_event.is_set():
        try:
            ready, _, _ = select.select([src_fd], [], [], 0.1)
        except (ValueError, OSError):
            # File descriptor was closed.
            break

        if not ready:
            continue

        try:
            data = os.read(src_fd, CHUNK)
            if not data:
                # EOF – peer closed; wait for stop event and exit.
                time.sleep(0.05)
                continue
        except (BlockingIOError, OSError):
            # Non-blocking read with nothing available.
            continue

        try:
            os.write(dst_fd, data)
        except (BlockingIOError, OSError):
            # If the destination is not ready, drop the data (or we could
            # buffer, but for a serial-like device dropping is acceptable).
            pass


def _set_nonblocking(fd: int) -> None:
    """Set the O_NONBLOCK flag on a file descriptor."""
    import fcntl
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


# ---------------------------------------------------------------------------
# Windows implementation
# ---------------------------------------------------------------------------

def _create_windows_pair() -> Tuple[str, str]:
    """
    Create a virtual serial port pair on Windows.

    Tries (in order):
    1. **com0com** – the well-known open-source virtual serial port driver.
       It ships with a command-line tool ``setupc.exe`` that can install
       port pairs programmatically.
    2. **socat** – if a Windows build of socat is on the PATH.
    """
    # Attempt 1: com0com
    ports = _create_with_com0com()
    if ports is not None:
        return ports

    # Attempt 2: socat
    ports = _create_with_socat()
    if ports is not None:
        return ports

    # Nothing worked – provide a helpful error.
    raise NotImplementedError(
        "Cannot create virtual serial ports on Windows.\n\n"
        "Please install one of the following tools:\n"
        "  1. com0com (recommended): https://sourceforge.net/projects/com0com/\n"
        "     After installation ensure 'setupc.exe' is in your PATH.\n"
        "  2. socat for Windows: http://www.dest-unreach.org/socat/\n"
        "     Place socat.exe somewhere on your PATH.\n\n"
        "Then retry the operation."
    )


def _cleanup_subprocesses() -> None:
    """Terminate any subprocesses that were spawned (e.g. socat)."""
    for proc in _managed_subprocesses:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    _managed_subprocesses.clear()


# --- com0com support -------------------------------------------------------

def _find_com0com_setupc() -> Optional[str]:
    """Return the path to ``setupc.exe`` or ``None``."""
    # Common installation locations:
    candidates = [
        # If it's on the PATH
        shutil.which("setupc.exe"),
        shutil.which("setupc"),
        # Typical 64-bit installation directory
        r"C:\Program Files (x86)\com0com\setupc.exe",
        r"C:\Program Files\com0com\setupc.exe",
        # Older / alternative
        r"C:\com0com\setupc.exe",
        # Another common location (32-bit on 64-bit system)
        r"C:\Program Files (x86)\com0com\i386\setupc.exe",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def _create_with_com0com() -> Optional[Tuple[str, str]]:
    """
    Try to create a pair using com0com.

    Returns a ``(port_a, port_b)`` tuple on success, or ``None`` if
    com0com is not available or the operation failed.
    """
    setupc = _find_com0com_setupc()
    if setupc is None:
        logger.debug("com0com setupc.exe not found.")
        return None

    # Query existing ports so we can figure out the names of the newly
    # created pair.
    before = _com0com_list_ports(setupc)

    # Install a new pair.  The `install` command with two `-` arguments
    # creates a pair with default names (usually CNCA0, CNCB0).
    # Syntax: setupc.exe install <portnameA> <portnameB> [options]
    # Using "-" for both tells com0com to use its default internal names.
    try:
        result = subprocess.run(
            [setupc, "install", "-", "-"],
            capture_output=True,
            text=True,
            timeout=15,
            # On many systems this requires elevation; we try anyway.
        )
        if result.returncode != 0:
            logger.debug("com0com install returned %d: %s",
                        result.returncode, result.stderr.strip())

            # Maybe the pair already exists? Try listing again.
            after = _com0com_list_ports(setupc)
            new_ports = after - before
            if len(new_ports) >= 2:
                port_list = sorted(new_ports)
                return port_list[0], port_list[1]

            # Another possibility: existing ports were renamed.
            # Return the first pair we can find from the "after" set.
            if len(after) >= 2:
                port_list = sorted(after)
                logger.info("Using existing com0com pair: %s <-> %s",
                            port_list[0], port_list[1])
                return port_list[0], port_list[1]

            return None

        after = _com0com_list_ports(setupc)
        new_ports = after - before
        if len(new_ports) >= 2:
            port_list = sorted(new_ports)
            logger.info("com0com pair created: %s <-> %s",
                        port_list[0], port_list[1])
            return port_list[0], port_list[1]

        # Fallback: if we cannot detect new ports, return default names.
        # com0com's default first pair is CNCA0/CNCB0.
        logger.info("com0com pair created (assuming CNCA0/CNCB0).")
        return "CNCA0", "CNCB0"

    except FileNotFoundError:
        logger.debug("com0com setupc not found at runtime.")
        return None
    except subprocess.TimeoutExpired:
        logger.debug("com0com install timed out.")
        return None
    except Exception as exc:
        logger.debug("com0com error: %s", exc)
        return None


def _com0com_list_ports(setupc_path: str) -> Set[str]:
    """
    Ask com0com to list currently installed port names.

    Returns a ``set`` of port-name strings (e.g. ``{"CNCA0", "CNCB0", ...}``).
    """
    try:
        result = subprocess.run(
            [setupc_path, "list"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return set()

        ports: Set[str] = set()
        for line in result.stdout.splitlines():
            # Typical output line: "CNCA0 PortName=COM3"
            # or just "CNCA0" when no alias is assigned.
            line = line.strip()
            if not line or line.startswith("-") or line.startswith("="):
                continue
            # Take the first whitespace-delimited token.
            token = line.split()[0].strip()
            if token:
                ports.add(token)
        return ports
    except Exception:
        return set()


# --- socat support (shared between Unix and Windows) -----------------------

def _find_socat() -> Optional[str]:
    """Return path to ``socat`` executable or ``None``."""
    return shutil.which("socat") or shutil.which("socat.exe")


def _create_with_socat() -> Optional[Tuple[str, str]]:
    """
    Use socat to create a pair of linked pseudo-terminals.

    On Unix this is a fallback when the built-in ``pty`` module cannot be
    used.  On Windows this is the secondary option after com0com.

    The function spawns a ``socat`` subprocess that creates two PTYs and
    links them together.  Symlinks to the PTY devices are placed in a
    temporary directory.

    Returns
    -------
    tuple[str, str] or None
        ``(link_a, link_b)`` paths on success, ``None`` on failure.
    """
    socat = _find_socat()
    if socat is None:
        logger.debug("socat not found.")
        return None

    # Create a temporary directory to hold symlinks to the PTY devices.
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix="virtual_serial_")
    link_a = os.path.join(tmpdir, "port_a")
    link_b = os.path.join(tmpdir, "port_b")

    cmd = [
        socat,
        "-d", "-d",               # verbose logging (goes to stderr)
        f"PTY,link={link_a},rawer",
        f"PTY,link={link_b},rawer",
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError:
        logger.debug("socat not found at runtime.")
        return None
    except Exception as exc:
        logger.debug("Failed to start socat: %s", exc)
        return None

    # Wait until both symlinks appear (socat creates them after opening
    # the PTYs).  Give it a few seconds.
    deadline = time.time() + 10
    while time.time() < deadline:
        if os.path.exists(link_a) and os.path.exists(link_b):
            break
        # Check if the process died prematurely.
        if proc.poll() is not None:
            stderr_text = ""
            if proc.stderr:
                stderr_text = proc.stderr.read()
            logger.debug("socat exited early (rc=%s). stderr: %s",
                        proc.returncode, stderr_text)
            try:
                os.rmdir(tmpdir)
            except OSError:
                pass
            return None
        time.sleep(0.2)
    else:
        # Timeout waiting for links.
        proc.terminate()
        proc.wait()
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass
        logger.debug("Timeout waiting for socat PTY links.")
        return None

    # Track for cleanup.
    _managed_subprocesses.append(proc)

    logger.info("socat virtual pair created: %s <-> %s", link_a, link_b)
    return link_a, link_b


# ---------------------------------------------------------------------------
# Convenience context manager
# ---------------------------------------------------------------------------

class VirtualSerialPair:
    """
    A context manager that creates a virtual serial port pair on entry and
    cleans up on exit.

    Example::

        with VirtualSerialPair() as (port1, port2):
            # use port1 and port2
            ser1 = serial.Serial(port1, 9600)
            ser2 = serial.Serial(port2, 9600)
            ...
    """

    def __init__(self) -> None:
        self._ports: Optional[Tuple[str, str]] = None

    def __enter__(self) -> Tuple[str, str]:
        self._ports = create_virtual_serial_pair()
        return self._ports

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        cleanup()
        return False


# ---------------------------------------------------------------------------
# Basic self-test (executed when the module is run directly)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("Testing virtual_serial module...")
    try:
        p1, p2 = create_virtual_serial_pair()
        print(f"SUCCESS: {p1} <-> {p2}")
        print("Keeping ports alive for 5 seconds... (press Ctrl+C to stop)")
        time.sleep(5)
    except Exception as e:
        print(f"FAILED: {e}")
    finally:
        cleanup()
        print("Cleanup complete.")
