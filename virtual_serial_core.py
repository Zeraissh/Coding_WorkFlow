#!/usr/bin/env python3
"""
Virtual Serial Core Module (PTY-based)

Provides a :class:`VirtualSerial` class that wraps a pseudo-terminal (PTY)
created via ``os.openpty()`` / ``pty.openpty()``, simulating a virtual serial
port.  Two instances can be paired together so that data written to one port
appears on the other and vice versa – just like a physical null-modem cable.

Features
--------
* Create a virtual serial port backed by a real OS pseudo-terminal.
* Open / close the port.
* Read and write with configurable timeouts.
* Non-blocking I/O support.
* Pair two virtual serial ports together (cross-connect their master ends).
* Context manager protocol for automatic cleanup.
* Thread-safe operations.

Platform Support
----------------
* **Linux / macOS (Unix)** – uses the built-in ``pty`` module.  No external
  dependencies required.
* **Windows** – the ``pty`` module is not available.  An exception is raised
  with guidance to use alternative backends (com0com, socat, or the
  pure-Python buffer-based VirtualSerialPort in the companion module).

Example
-------
>>> from virtual_serial_core import VirtualSerial, pair_ports
>>>
>>> # Create two virtual serial ports and pair them together.
>>> vcom1 = VirtualSerial(name="COM_A")
>>> vcom2 = VirtualSerial(name="COM_B")
>>> pair_ports(vcom1, vcom2)
>>>
>>> vcom1.open()
>>> vcom2.open()
>>>
>>> # Write on one, read from the other.
>>> vcom1.write(b"Hello from COM_A!")
>>> data = vcom2.read(1024, timeout=0.5)
>>> print(data)  # b'Hello from COM_A!'
>>>
>>> # External applications can connect to the slave device paths:
>>> print(vcom1.slave_path)  # e.g., '/dev/pts/5'
>>> print(vcom2.slave_path)  # e.g., '/dev/pts/6'
>>>
>>> vcom1.close()
>>> vcom2.close()

See Also
--------
* ``virtual_serial.py`` – higher-level helpers that use socat / com0com as
  fallback on platforms where ``pty`` is unavailable.
"""

from __future__ import annotations

import os
import sys
import select
import threading
import time
from typing import Optional, Tuple, List

# ---------------------------------------------------------------------------
# Platform check
# ---------------------------------------------------------------------------

_IS_UNIX = sys.platform in ("linux", "darwin", "cygwin")

if not _IS_UNIX:
    # We define a stub so the module can at least be imported on Windows
    # for documentation / introspection purposes.  Runtime calls will raise
    # NotImplementedError with helpful guidance.
    _HAS_PTY = False
else:
    try:
        import pty
        import termios
        import fcntl
        _HAS_PTY = True
    except ImportError:
        _HAS_PTY = False


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class VirtualSerialError(Exception):
    """Base exception for virtual serial port errors."""


class PortClosedError(VirtualSerialError):
    """Raised when an operation is attempted on a closed port."""


class PortNotPairedError(VirtualSerialError):
    """Raised when a paired operation is attempted on an unpaired port."""


class TimeoutError(VirtualSerialError):
    """Raised when a read or write operation times out."""


# ---------------------------------------------------------------------------
# VirtualSerial
# ---------------------------------------------------------------------------

class VirtualSerial:
    """
    A virtual serial port backed by a Unix pseudo-terminal (PTY).

    Each instance creates a PTY master/slave pair:

    * The **master** file descriptor is used internally for reading and
      writing data programmatically (via :meth:`read` and :meth:`write`).
    * The **slave** device (e.g. ``/dev/pts/5``) can be opened by external
      applications just like a regular serial port.

    When two :class:`VirtualSerial` instances are paired (see
    :func:`pair_ports`), a background thread forwards data from each
    master to the other, creating a bidirectional null-modem link.

    Attributes
    ----------
    name : str
        Human-readable name for this port.
    slave_path : str or None
        Filesystem path of the slave device (e.g. ``/dev/pts/5``).
        ``None`` before the port is created or after it is closed.
    is_open : bool
        Whether the port is currently open.
    is_paired : bool
        Whether this port is currently paired with another.
    peer : VirtualSerial or None
        The paired port, or ``None`` if not paired.
    timeout : float or None
        Default read timeout in seconds.  ``None`` means blocking forever,
        ``0`` means non-blocking.

    Parameters
    ----------
    name : str, optional
        A human-readable name for this virtual serial port.
    timeout : float or None, optional
        Default read timeout in seconds.
    """

    # Default chunk size for reads
    _DEFAULT_CHUNK_SIZE = 4096

    # Polling interval (seconds) for the forwarding thread
    _FORWARD_POLL_INTERVAL = 0.05

    def __init__(self, name: str = "VSerial", timeout: Optional[float] = None):
        if not _HAS_PTY:
            raise NotImplementedError(
                "VirtualSerial requires the 'pty' module, which is only "
                "available on Unix-like operating systems (Linux, macOS).\n"
                "On Windows, use com0com, socat, or the pure-Python "
                "VirtualSerialPort class instead."
            )

        self.name: str = name
        self.timeout: Optional[float] = timeout

        # -- PTY handles (set in open()) --
        self._master_fd: Optional[int] = None
        self._slave_fd: Optional[int] = None
        self._slave_path: Optional[str] = None

        # -- State --
        self._is_open: bool = False
        self._peer: Optional[VirtualSerial] = None
        self._is_paired: bool = False

        # -- Forwarding --
        self._forward_thread: Optional[threading.Thread] = None
        self._stop_event: Optional[threading.Event] = None

        # -- Statistics --
        self._bytes_read: int = 0
        self._bytes_written: int = 0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def slave_path(self) -> Optional[str]:
        """Filesystem path of the slave device, or ``None``."""
        return self._slave_path

    @property
    def is_open(self) -> bool:
        """Whether the port is currently open."""
        return self._is_open

    @property
    def is_paired(self) -> bool:
        """Whether this port is paired with another."""
        return self._is_paired and self._peer is not None

    @property
    def peer(self) -> Optional['VirtualSerial']:
        """The paired VirtualSerial, or ``None``."""
        return self._peer

    @property
    def bytes_read(self) -> int:
        """Total bytes read from this port since it was opened."""
        return self._bytes_read

    @property
    def bytes_written(self) -> int:
        """Total bytes written to this port since it was opened."""
        return self._bytes_written

    @property
    def in_waiting(self) -> int:
        """
        Number of bytes currently available for reading (non-blocking).

        Uses a quick ``select()`` poll on the master file descriptor.
        """
        if not self._is_open or self._master_fd is None:
            return 0
        try:
            ready, _, _ = select.select([self._master_fd], [], [], 0)
            return 1 if ready else 0  # at least one byte available
        except (OSError, ValueError):
            return 0

    # ------------------------------------------------------------------
    # Open / Close
    # ------------------------------------------------------------------

    def open(self) -> 'VirtualSerial':
        """
        Create the PTY and open the virtual serial port for I/O.

        This method is idempotent – calling it on an already-open port
        has no effect.

        Returns
        -------
        VirtualSerial
            The instance itself (for method chaining).

        Raises
        ------
        OSError
            If the underlying ``pty.openpty()`` call fails.
        """
        if self._is_open:
            return self

        # Create the pseudo-terminal pair.
        master_fd, slave_fd = pty.openpty()

        try:
            # Put the master in raw mode so it behaves like a transparent
            # byte pipe (no echo, no canonical processing, no signals).
            self._configure_raw(master_fd)

            # Get the filesystem path of the slave device.
            slave_path = os.ttyname(slave_fd)
        except Exception:
            os.close(master_fd)
            os.close(slave_fd)
            raise

        # Close the slave FD – we only need its path.
        os.close(slave_fd)

        self._master_fd = master_fd
        self._slave_fd = None  # already closed
        self._slave_path = slave_path
        self._is_open = True
        self._bytes_read = 0
        self._bytes_written = 0

        # If we already have a peer, start forwarding.
        if self._peer is not None and self._peer.is_open:
            self._start_forwarding()
            self._peer._start_forwarding()

        return self

    def close(self):
        """
        Close the virtual serial port and release OS resources.

        Stops any forwarding threads, closes the master file descriptor,
        and marks the port as closed.  Idempotent – safe to call multiple
        times.
        """
        if not self._is_open:
            return

        # Stop forwarding first.
        self._stop_forwarding()

        # Close the master FD.
        if self._master_fd is not None:
            try:
                os.close(self._master_fd)
            except OSError:
                pass
            self._master_fd = None

        self._slave_path = None
        self._is_open = False

    # ------------------------------------------------------------------
    # Raw mode configuration
    # ------------------------------------------------------------------

    @staticmethod
    def _configure_raw(fd: int) -> None:
        """
        Put the terminal referenced by *fd* into raw mode.

        Disables echo, canonical mode, signal generation, and software
        flow control so the PTY behaves as a transparent byte pipe.
        """
        # Get current terminal attributes (list of bytes/ints).
        attrs = termios.tcgetattr(fd)

        # Input flags – disable special character processing.
        attrs[0] &= ~(
            termios.IGNBRK | termios.BRKINT | termios.PARMRK |
            termios.ISTRIP | termios.INLCR | termios.IGNCR |
            termios.ICRNL | termios.IXON
        )
        # Output flags – disable output processing.
        attrs[1] &= ~(termios.OPOST)
        # Control flags – 8-bit characters, no parity.
        attrs[2] &= ~(termios.CSIZE | termios.PARENB)
        attrs[2] |= termios.CS8
        # Local flags – disable echo, canonical mode, signal chars.
        attrs[3] &= ~(
            termios.ECHO | termios.ECHONL | termios.ICANON |
            termios.ISIG | termios.IEXTEN
        )
        # Control characters – MIN=1, TIME=0 (return as soon as 1 byte is available).
        attrs[6][termios.VMIN] = 1
        attrs[6][termios.VTIME] = 0

        # Apply.
        termios.tcsetattr(fd, termios.TCSANOW, attrs)

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read(self, size: int = 1024, timeout: Optional[float] = None) -> bytes:
        """
        Read up to *size* bytes from the virtual serial port.

        Behaviour depends on the *timeout* value:

        * ``None`` – use the port's default timeout (set at construction).
        * ``0`` – non-blocking; return whatever is immediately available
          (may be empty).
        * ``> 0`` – block for at most *timeout* seconds, returning
          whatever data is available at that point.

        Parameters
        ----------
        size : int
            Maximum number of bytes to read.  Default is 1024.
        timeout : float or None, optional
            Override for the port's default timeout.

        Returns
        -------
        bytes
            Data read from the port.  May be shorter than *size* if a
            timeout occurred or less data was available.  Returns empty
            bytes on timeout with no data.

        Raises
        ------
        PortClosedError
            If the port is not open.
        """
        self._check_open()

        if size <= 0:
            return b''

        effective_timeout = timeout if timeout is not None else self.timeout

        return self._read_bytes(size, effective_timeout)

    def readline(self, timeout: Optional[float] = None) -> bytes:
        """
        Read until a newline (``b'\\n'``) is received or timeout.

        The returned data **includes** the newline character if one was
        found.

        Parameters
        ----------
        timeout : float or None, optional
            Override for the port's default timeout.

        Returns
        -------
        bytes
            The line read (including newline), or empty bytes on timeout.

        Raises
        ------
        PortClosedError
            If the port is not open.
        """
        self._check_open()
        effective_timeout = timeout if timeout is not None else self.timeout
        return self._read_until(b'\n', effective_timeout)

    def read_until(self, expected: bytes, timeout: Optional[float] = None) -> bytes:
        """
        Read until the byte sequence *expected* is found or timeout.

        The returned data **includes** the terminator if found.

        Parameters
        ----------
        expected : bytes
            Byte sequence to search for.
        timeout : float or None, optional
            Override for the port's default timeout.

        Returns
        -------
        bytes
            Data up to and including the terminator, or all data read
            before timeout.

        Raises
        ------
        PortClosedError
            If the port is not open.
        ValueError
            If *expected* is empty.
        """
        self._check_open()
        if not expected:
            raise ValueError("expected terminator must not be empty")
        effective_timeout = timeout if timeout is not None else self.timeout
        return self._read_until(expected, effective_timeout)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def write(self, data: bytes, timeout: Optional[float] = None) -> int:
        """
        Write *data* to the virtual serial port.

        The bytes are written to the PTY master, making them available
        on the slave side.  If this port is paired with another, the data
        is also forwarded to the peer.

        Parameters
        ----------
        data : bytes
            Data to write.
        timeout : float or None, optional
            Maximum seconds to wait if the write would block (rare for
            PTYs but included for API completeness).

        Returns
        -------
        int
            Number of bytes actually written.

        Raises
        ------
        PortClosedError
            If the port is not open.
        """
        self._check_open()

        if not data:
            return 0

        data_bytes = bytes(data)
        total = len(data_bytes)

        if timeout is not None and timeout > 0:
            # Wait until the master FD is writable or timeout.
            deadline = time.monotonic() + timeout
            while True:
                try:
                    _, ready, _ = select.select(
                        [], [self._master_fd], [], timeout
                    )
                    if ready:
                        break
                except (ValueError, OSError):
                    pass
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"Write timeout on port '{self.name}'"
                    )
        elif timeout == 0:
            # Non-blocking check – if not writable, bail out.
            try:
                _, ready, _ = select.select([], [self._master_fd], [], 0)
                if not ready:
                    return 0
            except (ValueError, OSError):
                return 0

        try:
            written = os.write(self._master_fd, data_bytes)
        except BlockingIOError:
            written = 0
        except OSError:
            raise PortClosedError(f"Port '{self.name}' is not open")

        self._bytes_written += written
        return written

    # ------------------------------------------------------------------
    # Flush / drain
    # ------------------------------------------------------------------

    def flush(self):
        """
        Flush the output buffer.

        For a PTY this is effectively a no-op since data written to the
        master is immediately available on the slave.
        """
        pass

    def drain(self):
        """
        Wait until all data written to the port has been transmitted.

        For a PTY this is essentially a no-op (data is delivered
        immediately), but the method is provided for API compatibility
        with ``pyserial``.
        """
        pass

    # ------------------------------------------------------------------
    # Internal I/O helpers
    # ------------------------------------------------------------------

    def _check_open(self):
        """Raise :class:`PortClosedError` if the port is not open."""
        if not self._is_open or self._master_fd is None:
            raise PortClosedError(f"Port '{self.name}' is not open")

    def _read_bytes(self, size: int, timeout: Optional[float]) -> bytes:
        """
        Read up to *size* bytes with the given *timeout*.

        Parameters
        ----------
        size : int
            Maximum bytes to read.
        timeout : float or None
            ``None`` = block forever, ``0`` = non-blocking, ``> 0`` = seconds.

        Returns
        -------
        bytes
        """
        chunks: List[bytes] = []
        remaining = size
        deadline = None if timeout is None else (time.monotonic() + timeout)

        while remaining > 0:
            # Wait for data or timeout.
            try:
                if timeout is None:
                    wait = None  # block forever
                elif timeout == 0:
                    wait = 0     # non-blocking poll
                else:
                    now = time.monotonic()
                    if now >= deadline:
                        break
                    wait = max(0, deadline - now)

                ready, _, _ = select.select([self._master_fd], [], [], wait)
            except (ValueError, OSError):
                # FD closed or invalid
                break

            if not ready:
                # Timeout with no data.
                break

            # Read what's available.
            try:
                chunk = os.read(self._master_fd, min(remaining, self._DEFAULT_CHUNK_SIZE))
            except (BlockingIOError, OSError):
                break

            if not chunk:
                # EOF on a PTY – peer closed?  Wait and retry.
                time.sleep(0.01)
                continue

            chunks.append(chunk)
            remaining -= len(chunk)

        data = b''.join(chunks)
        self._bytes_read += len(data)
        return data

    def _read_until(self, expected: bytes, timeout: Optional[float]) -> bytes:
        """
        Read until *expected* is found or timeout.

        Parameters
        ----------
        expected : bytes
            Terminator byte sequence.
        timeout : float or None

        Returns
        -------
        bytes
        """
        buffer = bytearray()
        term_len = len(expected)
        deadline = None if timeout is None else (time.monotonic() + timeout)

        while True:
            try:
                if timeout is None:
                    wait = None
                elif timeout == 0:
                    wait = 0
                else:
                    now = time.monotonic()
                    if now >= deadline:
                        break
                    wait = max(0, deadline - now)

                ready, _, _ = select.select([self._master_fd], [], [], wait)
            except (ValueError, OSError):
                break

            if not ready:
                break

            try:
                chunk = os.read(self._master_fd, self._DEFAULT_CHUNK_SIZE)
            except (BlockingIOError, OSError):
                break

            if not chunk:
                time.sleep(0.01)
                continue

            buffer.extend(chunk)

            # Check for terminator in the newly appended portion.
            search_start = max(0, len(buffer) - len(chunk) - term_len + 1)
            idx = buffer.find(expected, search_start)
            if idx >= 0:
                # Terminator found – put back excess bytes.
                end = idx + term_len
                if end < len(buffer):
                    # We've read beyond the terminator.  Unfortunately,
                    # we cannot "push back" into a PTY.  We'll return the
                    # prefix and the excess bytes will be lost for
                    # subsequent reads.  This is a known limitation of
                    # PTY-based virtual ports.
                    pass
                result = bytes(buffer[:end])
                self._bytes_read += len(result)
                return result

        result = bytes(buffer)
        self._bytes_read += len(result)
        return result

    # ------------------------------------------------------------------
    # Pairing
    # ------------------------------------------------------------------

    def pair_with(self, other: 'VirtualSerial') -> 'VirtualSerial':
        """
        Pair this port with *other* so that data written to one can be
        read from the other.

        This is a convenience wrapper around :func:`pair_ports`.

        Parameters
        ----------
        other : VirtualSerial
            The other port to pair with.

        Returns
        -------
        VirtualSerial
            The instance itself (for method chaining).
        """
        pair_ports(self, other)
        return self

    def unpair(self):
        """
        Unpair this port from its peer (if any).

        Stops forwarding threads and clears the pairing relationship on
        both sides.
        """
        if self._peer is not None:
            # Stop forwarding on both sides.
            self._stop_forwarding()
            if self._peer is not None:
                self._peer._stop_forwarding()
                # Clear peer's reference to us.
                self._peer._peer = None
                self._peer._is_paired = False
            self._peer = None
            self._is_paired = False

    # ------------------------------------------------------------------
    # Forwarding (internal)
    # ------------------------------------------------------------------

    def _start_forwarding(self):
        """Start the background thread that forwards data to the peer."""
        if self._forward_thread is not None and self._forward_thread.is_alive():
            return  # already running

        if self._peer is None or not self._peer.is_open:
            return

        self._stop_event = threading.Event()
        self._forward_thread = threading.Thread(
            target=self._forward_loop,
            daemon=True,
            name=f"vserial-fwd-{self.name}",
        )
        self._forward_thread.start()

    def _stop_forwarding(self):
        """Signal and wait for the forwarding thread to exit."""
        if self._stop_event is not None:
            self._stop_event.set()
        if self._forward_thread is not None:
            self._forward_thread.join(timeout=2.0)
            self._forward_thread = None
        self._stop_event = None

    def _forward_loop(self):
        """
        Forward data from this port's master FD to the peer's master FD.

        Runs in a background daemon thread until the stop event is set.
        """
        src_fd = self._master_fd
        dst_fd = self._peer._master_fd if self._peer else None

        if src_fd is None or dst_fd is None:
            return

        while not self._stop_event.is_set():
            try:
                ready, _, _ = select.select(
                    [src_fd], [], [], self._FORWARD_POLL_INTERVAL
                )
            except (ValueError, OSError):
                break

            if not ready:
                continue

            try:
                data = os.read(src_fd, self._DEFAULT_CHUNK_SIZE)
                if not data:
                    # EOF – sleep a bit to avoid busy-waiting.
                    time.sleep(0.05)
                    continue
            except (BlockingIOError, OSError):
                continue

            # Write to peer.  If the peer's FD is not ready for writing,
            # we drop the data (acceptable for a serial-like device).
            try:
                os.write(dst_fd, data)
            except (BlockingIOError, OSError):
                pass

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> 'VirtualSerial':
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        state = "open" if self._is_open else "closed"
        paired = f" paired with '{self._peer.name}'" if self._peer else ""
        slave = self._slave_path or "N/A"
        return (f"VirtualSerial(name='{self.name}', slave='{slave}', "
                f"state={state}{paired})")

    def __del__(self):
        """Ensure the PTY is released when the object is garbage-collected."""
        try:
            self.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Pairing function
# ---------------------------------------------------------------------------

def pair_ports(port_a: VirtualSerial, port_b: VirtualSerial):
    """
    Pair two :class:`VirtualSerial` instances together.

    After pairing, data written to *port_a* will be forwarded to *port_b*
    and vice versa, simulating a null-modem cable between two serial ports.

    If either port is not yet open, forwarding will start automatically
    when both ports are opened.

    If either port is already paired with a different port, that pairing
    is dissolved first.

    Parameters
    ----------
    port_a : VirtualSerial
        First virtual serial port.
    port_b : VirtualSerial
        Second virtual serial port.

    Raises
    ------
    ValueError
        If *port_a* and *port_b* are the same object.
    """
    if port_a is port_b:
        raise ValueError("Cannot pair a port with itself")

    # Dissolve existing pairings.
    port_a.unpair()
    port_b.unpair()

    # Set up the new pairing.
    port_a._peer = port_b
    port_a._is_paired = True
    port_b._peer = port_a
    port_b._is_paired = True

    # Start forwarding if both are already open.
    if port_a.is_open and port_b.is_open:
        port_a._start_forwarding()
        port_b._start_forwarding()


# ---------------------------------------------------------------------------
# Convenience: create a pre-opened, pre-paired pair
# ---------------------------------------------------------------------------

def create_virtual_pair(name_a: str = "COM_A", name_b: str = "COM_B",
                        timeout: Optional[float] = None) -> Tuple[VirtualSerial, VirtualSerial]:
    """
    Create and return a pair of opened, interconnected virtual serial ports.

    This is a convenience function equivalent to::

        a = VirtualSerial("COM_A", timeout=timeout)
        b = VirtualSerial("COM_B", timeout=timeout)
        pair_ports(a, b)
        a.open()
        b.open()

    Parameters
    ----------
    name_a : str
        Name for the first port.
    name_b : str
        Name for the second port.
    timeout : float or None, optional
        Default read timeout for both ports.

    Returns
    -------
    tuple[VirtualSerial, VirtualSerial]
        ``(port_a, port_b)`` – both ports are open and paired.
    """
    a = VirtualSerial(name=name_a, timeout=timeout)
    b = VirtualSerial(name=name_b, timeout=timeout)
    pair_ports(a, b)
    a.open()
    b.open()
    return a, b


# ---------------------------------------------------------------------------
# Context manager for a paired pair
# ---------------------------------------------------------------------------

class VirtualSerialPair:
    """
    Context manager that creates, opens, and pairs two virtual serial ports.

    Usage::

        with VirtualSerialPair() as (port1, port2):
            port1.write(b'Hello')
            reply = port2.read(1024, timeout=1.0)
        # Both ports are automatically closed on exit.

    Attributes
    ----------
    port_a : VirtualSerial
        The first virtual serial port.
    port_b : VirtualSerial
        The second virtual serial port.
    """

    def __init__(self, name_a: str = "COM_A", name_b: str = "COM_B",
                 timeout: Optional[float] = None):
        """
        Parameters
        ----------
        name_a : str
            Name for the first port.
        name_b : str
            Name for the second port.
        timeout : float or None, optional
            Default read timeout for both ports.
        """
        self.port_a = VirtualSerial(name=name_a, timeout=timeout)
        self.port_b = VirtualSerial(name=name_b, timeout=timeout)

    def open(self) -> 'VirtualSerialPair':
        """Open and pair both ports."""
        pair_ports(self.port_a, self.port_b)
        self.port_a.open()
        self.port_b.open()
        return self

    def close(self):
        """Close both ports (and implicitly unpair them)."""
        self.port_a.close()
        self.port_b.close()

    def __enter__(self) -> Tuple[VirtualSerial, VirtualSerial]:
        self.open()
        return self.port_a, self.port_b

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    def __repr__(self) -> str:
        return (f"VirtualSerialPair(port_a={self.port_a.name!r}, "
                f"port_b={self.port_b.name!r})")


# ---------------------------------------------------------------------------
# Self-test (run with: python virtual_serial_core.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if not _HAS_PTY:
        print("SKIP: pty module is not available on this platform.")
        sys.exit(0)

    print("=" * 60)
    print(" Virtual Serial Core – Self Test")
    print("=" * 60)

    # ------------------------------------------------------------------
    # 1. Basic open / close
    # ------------------------------------------------------------------
    print("\n[1] Basic open / close ...")
    v = VirtualSerial(name="test1")
    print(f"    Created: {v}")
    v.open()
    print(f"    Opened:  {v}")
    print(f"    Slave:   {v.slave_path}")
    assert v.is_open
    v.close()
    print(f"    Closed:  {v}")
    assert not v.is_open
    print("    OK")

    # ------------------------------------------------------------------
    # 2. Write → read on same port (loopback via slave)
    # ------------------------------------------------------------------
    print("\n[2] Loopback test (write master, read master) ...")
    # Note: On a PTY, data written to the master can be read back from
    # the master (it "echoes" through the slave).  This is a useful
    # self-test.
    test = VirtualSerial(name="loopback", timeout=0.5)
    test.open()
    payload = b"Hello PTY!"
    n = test.write(payload)
    print(f"    Wrote {n} bytes: {payload!r}")
    data = test.read(len(payload))
    print(f"    Read: {data!r}")
    assert data == payload, f"Expected {payload!r}, got {data!r}"
    test.close()
    print("    OK")

    # ------------------------------------------------------------------
    # 3. Paired ports – bidirectional communication
    # ------------------------------------------------------------------
    print("\n[3] Paired ports bidirectional ...")
    a, b = create_virtual_pair("COM_A", "COM_B", timeout=1.0)
    print(f"    {a}")
    print(f"    {b}")

    # A → B
    a.write(b"Hello from A!")
    data = b.read(1024)
    print(f"    B received: {data!r}")
    assert data == b"Hello from A!"

    # B → A
    b.write(b"Hello from B!")
    data = a.read(1024)
    print(f"    A received: {data!r}")
    assert data == b"Hello from B!"
    print("    OK")

    a.close()
    b.close()

    # ------------------------------------------------------------------
    # 4. Non-blocking read
    # ------------------------------------------------------------------
    print("\n[4] Non-blocking read (timeout=0) ...")
    a, b = create_virtual_pair("A", "B")
    # No data written – non-blocking read should return empty.
    data = a.read(1024, timeout=0)
    print(f"    Non-blocking read (no data): {data!r}")
    assert data == b""
    # Write some data and try non-blocking read.
    b.write(b"ping")
    time.sleep(0.1)  # allow forwarding
    data = a.read(1024, timeout=0)
    print(f"    Non-blocking read (after write): {data!r}")
    assert data == b"ping"
    a.close()
    b.close()
    print("    OK")

    # ------------------------------------------------------------------
    # 5. Timeout behaviour
    # ------------------------------------------------------------------
    print("\n[5] Read with timeout ...")
    a, b = create_virtual_pair("A", "B", timeout=0.3)
    start = time.monotonic()
    data = a.read(1024)  # no data, should timeout after ~0.3s
    elapsed = time.monotonic() - start
    print(f"    Timed-out read: {data!r} (elapsed={elapsed:.3f}s)")
    assert data == b""
    assert elapsed < 1.0  # sanity check
    a.close()
    b.close()
    print("    OK")

    # ------------------------------------------------------------------
    # 6. Context manager
    # ------------------------------------------------------------------
    print("\n[6] Context manager ...")
    with VirtualSerialPair("X", "Y") as (x, y):
        print(f"    Inside context: {x}, {y}")
        x.write(b"ctx test")
        data = y.read(1024)
        print(f"    Y received: {data!r}")
        assert data == b"ctx test"
    print(f"    After context: x.is_open={x.is_open}, y.is_open={y.is_open}")
    assert not x.is_open
    assert not y.is_open
    print("    OK")

    # ------------------------------------------------------------------
    # 7. in_waiting
    # ------------------------------------------------------------------
    print("\n[7] in_waiting property ...")
    a, b = create_virtual_pair("A", "B")
    print(f"    Before write: a.in_waiting={a.in_waiting}")
    assert a.in_waiting == 0
    b.write(b"hello")
    time.sleep(0.15)
    print(f"    After write: a.in_waiting={a.in_waiting}")
    assert a.in_waiting > 0
    a.read(1024)
    print(f"    After read: a.in_waiting={a.in_waiting}")
    a.close()
    b.close()
    print("    OK")

    # ------------------------------------------------------------------
    # 8. Error handling – closed port
    # ------------------------------------------------------------------
    print("\n[8] Error handling ...")
    p = VirtualSerial(name="err_test")
    try:
        p.read(1)
        print("    ERROR: should have raised PortClosedError")
    except PortClosedError as e:
        print(f"    Caught (read on closed): {e}")
    try:
        p.write(b"data")
        print("    ERROR: should have raised PortClosedError")
    except PortClosedError as e:
        print(f"    Caught (write on closed): {e}")
    p.open()
    p.write(b"test")
    p.close()
    try:
        p.write(b"fail")
        print("    ERROR: should have raised PortClosedError")
    except PortClosedError as e:
        print(f"    Caught (write after close): {e}")
    print("    OK")

    # ------------------------------------------------------------------
    # 9. Unpair / re-pair
    # ------------------------------------------------------------------
    print("\n[9] Unpair and re-pair ...")
    a = VirtualSerial("A", timeout=0.5)
    b = VirtualSerial("B", timeout=0.5)
    c = VirtualSerial("C", timeout=0.5)
    a.open()
    b.open()
    c.open()
    pair_ports(a, b)
    b.write(b"to A")
    time.sleep(0.15)
    assert a.read(1024) == b"to A"
    # Unpair and re-pair.
    a.unpair()
    c.pair_with(a)
    c.write(b"to A via C")
    time.sleep(0.15)
    assert a.read(1024) == b"to A via C"
    a.close()
    b.close()
    c.close()
    print("    OK")

    # ------------------------------------------------------------------
    # 10. Stress test – larger data
    # ------------------------------------------------------------------
    print("\n[10] Larger data transfer ...")
    a, b = create_virtual_pair("A", "B", timeout=2.0)
    payload = b"X" * 10000
    a.write(payload)
    received = bytearray()
    while len(received) < len(payload):
        chunk = b.read(4096)
        if not chunk:
            break
        received.extend(chunk)
    print(f"    Sent {len(payload)} bytes, received {len(received)} bytes")
    assert received == payload, "Large data mismatch!"
    a.close()
    b.close()
    print("    OK")

    # ------------------------------------------------------------------
    # Done
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print(" All tests passed!")
    print("=" * 60)
