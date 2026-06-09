#!/usr/bin/env python3
"""
Virtual Serial Port Core Module

Provides a VirtualSerialPair class that creates a pair of interconnected
virtual serial ports. Data written to one port can be read from the other,
simulating a physical null-modem cable connection.

Supports:
    - Opening and closing ports independently
    - Reading and writing data with timeout
    - Serial port parameter configuration (baudrate, bytesize, parity, stopbits)
    - Context manager protocol for the pair
    - Thread-safe operations on all methods
"""

import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Optional, List


# ---------------------------------------------------------------------------
# Constants (matching pySerial conventions)
# ---------------------------------------------------------------------------

class Parity:
    """Parity constants."""
    NONE = 'N'
    EVEN = 'E'
    ODD = 'O'
    MARK = 'M'
    SPACE = 'S'


class StopBits:
    """Stop bits constants."""
    ONE = 1
    ONE_POINT_FIVE = 1.5
    TWO = 2


class ByteSize:
    """Byte size constants."""
    FIVEBITS = 5
    SIXBITS = 6
    SEVENBITS = 7
    EIGHTBITS = 8


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class SerialConfig:
    """Serial port configuration parameters."""
    baudrate: int = 9600
    bytesize: int = ByteSize.EIGHTBITS
    parity: str = Parity.NONE
    stopbits: float = StopBits.ONE
    timeout: Optional[float] = None
    write_timeout: Optional[float] = None

    def validate(self):
        """Validate configuration values.

        Raises:
            ValueError: If any parameter is invalid.
        """
        if not isinstance(self.baudrate, int) or self.baudrate <= 0:
            raise ValueError(f"Invalid baudrate: {self.baudrate}")
        if self.bytesize not in (5, 6, 7, 8):
            raise ValueError(f"Invalid bytesize: {self.bytesize}")
        if self.parity not in (Parity.NONE, Parity.EVEN, Parity.ODD,
                               Parity.MARK, Parity.SPACE):
            raise ValueError(f"Invalid parity: {self.parity}")
        if self.stopbits not in (1, 1.5, 2):
            raise ValueError(f"Invalid stopbits: {self.stopbits}")

    def copy(self) -> 'SerialConfig':
        """Return a shallow copy of the configuration."""
        return SerialConfig(
            baudrate=self.baudrate,
            bytesize=self.bytesize,
            parity=self.parity,
            stopbits=self.stopbits,
            timeout=self.timeout,
            write_timeout=self.write_timeout,
        )


# ---------------------------------------------------------------------------
# Virtual Serial Port (one endpoint)
# ---------------------------------------------------------------------------

class VirtualSerialPort:
    """
    One endpoint of a virtual serial port pair.

    Provides a file-like interface (read, write, close) and tracks
    the open/closed state.  All public methods are thread-safe.

    Data written to this port is delivered to the **peer** port's input
    buffer.  Reading from this port returns data that was written by
    the peer.
    """

    def __init__(self, name: str, peer: 'VirtualSerialPort' = None,
                 config: SerialConfig = None):
        """
        Initialize a virtual serial port endpoint.

        Args:
            name: Human-readable name (e.g. ``"COM_A"``, ``"vport0"``).
            peer: The paired VirtualSerialPort.  May be set after creation.
            config: Serial configuration; defaults to 9600-8-N-1.
        """
        self._name = name
        self._peer: Optional['VirtualSerialPort'] = peer
        self._config = (config or SerialConfig()).copy()
        self._config.validate()

        self._is_open = False

        # Internal buffer: a deque of bytes objects, protected by a Condition
        # so that blocking reads can wait efficiently for new data.
        self._deque: deque = deque()
        self._cond = threading.Condition(threading.Lock())

        self._total_bytes_read = 0
        self._total_bytes_written = 0

    # -- properties ----------------------------------------------------------

    @property
    def name(self) -> str:
        """The port's human-readable name."""
        return self._name

    @property
    def peer(self) -> Optional['VirtualSerialPort']:
        """The paired VirtualSerialPort (other end of the null-modem cable)."""
        return self._peer

    @peer.setter
    def peer(self, value: 'VirtualSerialPort'):
        self._peer = value

    @property
    def is_open(self) -> bool:
        """Return ``True`` if the port is open."""
        return self._is_open

    @property
    def baudrate(self) -> int:
        return self._config.baudrate

    @baudrate.setter
    def baudrate(self, value: int):
        self._config.baudrate = value
        self._config.validate()

    @property
    def bytesize(self) -> int:
        return self._config.bytesize

    @bytesize.setter
    def bytesize(self, value: int):
        self._config.bytesize = value
        self._config.validate()

    @property
    def parity(self) -> str:
        return self._config.parity

    @parity.setter
    def parity(self, value: str):
        self._config.parity = value
        self._config.validate()

    @property
    def stopbits(self) -> float:
        return self._config.stopbits

    @stopbits.setter
    def stopbits(self, value: float):
        self._config.stopbits = value
        self._config.validate()

    @property
    def timeout(self) -> Optional[float]:
        return self._config.timeout

    @timeout.setter
    def timeout(self, value: Optional[float]):
        self._config.timeout = value

    @property
    def write_timeout(self) -> Optional[float]:
        return self._config.write_timeout

    @write_timeout.setter
    def write_timeout(self, value: Optional[float]):
        self._config.write_timeout = value

    @property
    def in_waiting(self) -> int:
        """Return the number of bytes currently waiting in the input buffer."""
        with self._cond:
            return sum(len(chunk) for chunk in self._deque)

    @property
    def out_waiting(self) -> int:
        """Bytes waiting in the peer's input buffer (i.e. written by this
        port but not yet read by the other side)."""
        if self._peer is not None:
            return self._peer.in_waiting
        return 0

    @property
    def total_bytes_read(self) -> int:
        return self._total_bytes_read

    @property
    def total_bytes_written(self) -> int:
        return self._total_bytes_written

    # -- open / close --------------------------------------------------------

    def open(self) -> 'VirtualSerialPort':
        """Open the virtual serial port.  Idempotent."""
        self._is_open = True
        return self

    def close(self):
        """Close the virtual serial port and discard all buffered data."""
        self._is_open = False
        with self._cond:
            self._deque.clear()
            self._cond.notify_all()  # wake up any blocked readers

    def _check_open(self):
        """Raise OSError if the port is not open."""
        if not self._is_open:
            raise OSError(f"Port '{self._name}' is not open")

    def _check_peer(self):
        """Raise OSError if no peer is connected or the peer is closed."""
        if self._peer is None:
            raise OSError(f"Port '{self._name}' has no peer connected")
        if not self._peer._is_open:
            raise OSError(f"Peer port '{self._peer._name}' is not open")

    # -- internal buffer helpers ---------------------------------------------

    def _put_data(self, data: bytes):
        """Append *data* to the input buffer and notify waiting readers."""
        with self._cond:
            self._deque.append(data)
            self._cond.notify_all()

    def _get_bytes(self, size: int, timeout: Optional[float]) -> bytes:
        """
        Read up to *size* bytes from the internal buffer, blocking
        according to *timeout*.

        Args:
            size: Maximum number of bytes to read.
            timeout: ``None`` = block forever, ``0`` = non-blocking,
                     ``> 0`` = seconds to wait.

        Returns:
            Bytes read (may be fewer than *size* on timeout).
        """
        chunks: List[bytes] = []
        remaining = size
        deadline = None if timeout is None else (time.monotonic() + timeout)

        with self._cond:
            while remaining > 0:
                # Consume as much as possible from the deque
                while self._deque:
                    chunk = self._deque[0]
                    if len(chunk) <= remaining:
                        # Consume entire chunk
                        self._deque.popleft()
                        chunks.append(chunk)
                        remaining -= len(chunk)
                    else:
                        # Chunk is larger than needed – split it
                        chunks.append(chunk[:remaining])
                        self._deque[0] = chunk[remaining:]
                        remaining = 0
                        break

                if remaining == 0:
                    break

                # No (more) data available – should we wait?
                if timeout == 0:
                    # Non-blocking – return what we have
                    break
                if timeout is not None:
                    now = time.monotonic()
                    if now >= deadline:
                        break
                    wait = deadline - now
                else:
                    wait = None

                # Wait for new data (or close)
                if not self._cond.wait(timeout=wait):
                    # Timed out
                    break

        data = b''.join(chunks)
        self._total_bytes_read += len(data)
        return data

    # -- read ----------------------------------------------------------------

    def read(self, size: int = 1) -> bytes:
        """
        Read up to *size* bytes from the port.

        Behaviour depends on the *timeout* setting:

        * ``None`` (default) – block until *size* bytes are available.
        * ``0`` – non-blocking; return whatever is available immediately
          (may be empty).
        * ``> 0`` – block for at most *timeout* seconds; return whatever
          is available when the timeout expires.

        Returns an empty bytes object on timeout or if the port is closed
        while waiting.

        Args:
            size: Maximum number of bytes to read (default 1).

        Returns:
            Bytes read from the port.

        Raises:
            OSError: If the port is not open.
        """
        self._check_open()
        if size <= 0:
            return b''
        return self._get_bytes(size, self._config.timeout)

    def read_until(self, expected: bytes = b'\n',
                   size: Optional[int] = None) -> bytes:
        """
        Read until *expected* byte sequence is found, *size* bytes have
        been read, or a timeout occurs.

        The returned data **includes** the terminator if it was found.

        Args:
            expected: Byte sequence to look for (default ``b'\\n'``).
            size: Maximum number of bytes to read (optional).

        Returns:
            Bytes read.

        Raises:
            OSError: If the port is not open.
        """
        self._check_open()

        if not expected:
            # No terminator – read all available up to *size*
            if size is not None:
                return self.read(size)
            # Read everything available
            return self._get_bytes(self.in_waiting or 1, self._config.timeout)

        timeout = self._config.timeout
        deadline = None if timeout is None else (time.monotonic() + timeout)
        buffer = bytearray()
        term_len = len(expected)

        with self._cond:
            while size is None or len(buffer) < size:
                # Grab data from deque
                while self._deque:
                    chunk = self._deque[0]
                    take = chunk
                    if size is not None:
                        max_take = size - len(buffer)
                        if len(chunk) > max_take:
                            take = chunk[:max_take]
                            self._deque[0] = chunk[max_take:]
                        else:
                            self._deque.popleft()
                    else:
                        self._deque.popleft()

                    buffer.extend(take)

                    # Check for terminator in the *recently appended* portion
                    # (search only the tail of buffer for efficiency)
                    search_start = max(0, len(buffer) - len(take) - term_len + 1)
                    idx = buffer.find(expected, search_start)
                    if idx >= 0:
                        # Terminator found – put back excess bytes
                        end = idx + term_len
                        if end < len(buffer):
                            excess = bytes(buffer[end:])
                            self._deque.appendleft(excess)
                            buffer = buffer[:end]
                        # Done
                        result = bytes(buffer)
                        self._total_bytes_read += len(result)
                        return result

                    if size is not None and len(buffer) >= size:
                        result = bytes(buffer)
                        self._total_bytes_read += len(result)
                        return result

                # No (more) data – wait
                if timeout == 0:
                    break
                if timeout is not None:
                    now = time.monotonic()
                    if now >= deadline:
                        break
                    wait = deadline - now
                else:
                    wait = None

                if not self._cond.wait(timeout=wait):
                    break

        result = bytes(buffer)
        self._total_bytes_read += len(result)
        return result

    def readline(self, size: Optional[int] = None) -> bytes:
        """Read one line.  Convenience wrapper around :meth:`read_until`."""
        return self.read_until(expected=b'\n', size=size)

    def readlines(self, hint: Optional[int] = None) -> List[bytes]:
        """
        Read multiple lines.

        Args:
            hint: Approximate maximum total bytes to read (optional).

        Returns:
            List of lines (each ending with ``b'\\n'``).
        """
        lines: List[bytes] = []
        total = 0
        while True:
            line = self.readline()
            if not line:
                break
            lines.append(line)
            total += len(line)
            if hint is not None and total >= hint:
                break
        return lines

    # -- write ---------------------------------------------------------------

    def write(self, data: bytes) -> int:
        """
        Write *data* to the port.  The bytes are delivered to the **peer**
        port's input buffer.

        Args:
            data: Bytes to write.

        Returns:
            Number of bytes written.

        Raises:
            OSError: If the port is not open or the peer is not connected/open.
            TimeoutError: If *write_timeout* is set and the write would block
                longer than allowed.
        """
        self._check_open()
        self._check_peer()

        data = bytes(data)
        if not data:
            return 0

        # For a virtual port the write is effectively instantaneous (we just
        # append to the peer's deque).  The write_timeout mainly exists for
        # API compatibility; we honour it by raising if a lock cannot be
        # acquired in time (extremely unlikely for an uncontended lock).

        write_timeout = self._config.write_timeout
        if write_timeout is not None:
            acquired = self._peer._cond.acquire(timeout=write_timeout)
            if not acquired:
                raise TimeoutError(f"Write timeout on port '{self._name}'")
            try:
                self._peer._deque.append(data)
                self._peer._cond.notify_all()
            finally:
                self._peer._cond.release()
        else:
            self._peer._put_data(data)

        self._total_bytes_written += len(data)
        return len(data)

    def flush(self):
        """No-op for virtual ports (data is delivered immediately)."""
        pass

    # -- buffer management ---------------------------------------------------

    def reset_input_buffer(self):
        """Discard all data in the input buffer."""
        with self._cond:
            self._deque.clear()

    def reset_output_buffer(self):
        """Discard data written by this port but not yet read by the peer."""
        if self._peer is not None:
            self._peer.reset_input_buffer()

    def reset_counters(self):
        """Reset the bytes-read / bytes-written counters to zero."""
        self._total_bytes_read = 0
        self._total_bytes_written = 0

    # -- magic methods -------------------------------------------------------

    def __repr__(self) -> str:
        state = "open" if self._is_open else "closed"
        peer_name = self._peer.name if self._peer else "None"
        return (f"VirtualSerialPort(name='{self._name}', "
                f"peer='{peer_name}', state={state})")


# ---------------------------------------------------------------------------
# Virtual Serial Pair
# ---------------------------------------------------------------------------

class VirtualSerialPair:
    """
    A pair of interconnected virtual serial ports.

    Creating an instance automatically creates two :class:`VirtualSerialPort`
    objects (``port0`` and ``port1``) that are cross-connected: data written
    to ``port0`` appears in ``port1``'s input buffer and vice versa.

    Supports the context manager protocol::

        with VirtualSerialPair() as pair:
            pair.port0.write(b'Hello')
            reply = pair.port1.read(5)
        # Both ports are automatically closed on exit.

    Attributes:
        port0: First virtual serial port.
        port1: Second virtual serial port.
    """

    def __init__(self,
                 port0_name: str = "VCOM0",
                 port1_name: str = "VCOM1",
                 config0: Optional[SerialConfig] = None,
                 config1: Optional[SerialConfig] = None):
        """
        Create a virtual serial port pair.

        Args:
            port0_name: Name for the first port.
            port1_name: Name for the second port.
            config0: Configuration for port0 (default: 9600-8-N-1).
            config1: Configuration for port1 (default: 9600-8-N-1).
        """
        self.port0 = VirtualSerialPort(name=port0_name, config=config0)
        self.port1 = VirtualSerialPort(name=port1_name, config=config1)

        # Cross-connect the two endpoints
        self.port0.peer = self.port1
        self.port1.peer = self.port0

    # -- open / close --------------------------------------------------------

    def open(self) -> 'VirtualSerialPair':
        """Open both ports."""
        self.port0.open()
        self.port1.open()
        return self

    def close(self):
        """Close both ports."""
        self.port0.close()
        self.port1.close()

    @property
    def is_open(self) -> bool:
        """Return ``True`` if **both** ports are open."""
        return self.port0.is_open and self.port1.is_open

    # -- configuration shortcuts ---------------------------------------------

    def set_baudrate(self, baudrate: int):
        """Set the same baudrate on both ports."""
        self.port0.baudrate = baudrate
        self.port1.baudrate = baudrate

    def set_config(self, config: SerialConfig):
        """Apply the same configuration to both ports."""
        self.port0._config = config.copy()
        self.port0._config.validate()
        self.port1._config = config.copy()
        self.port1._config.validate()

    # -- context manager -----------------------------------------------------

    def __enter__(self) -> 'VirtualSerialPair':
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False  # do not suppress exceptions

    # -- representation ------------------------------------------------------

    def __repr__(self) -> str:
        return (f"VirtualSerialPair(port0={self.port0.name!r}, "
                f"port1={self.port1.name!r}, open={self.is_open})")


# ---------------------------------------------------------------------------
# Helper – quick creation of a pre-opened pair
# ---------------------------------------------------------------------------

def create_virtual_pair(name_a: str = "COM_A", name_b: str = "COM_B",
                        baudrate: int = 9600) -> VirtualSerialPair:
    """
    Convenience function that creates and opens a virtual serial pair.

    Args:
        name_a: Name for the first port.
        name_b: Name for the second port.
        baudrate: Common baudrate for both ports.

    Returns:
        An **already opened** :class:`VirtualSerialPair`.
    """
    config = SerialConfig(baudrate=baudrate)
    pair = VirtualSerialPair(port0_name=name_a, port1_name=name_b,
                             config0=config, config1=config)
    pair.open()
    return pair


# ---------------------------------------------------------------------------
# Self-test (run with: python virtual_serial_core.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=== Virtual Serial Port Core - Self Test ===\n")

    # ------------------------------------------------------------------
    # 1. Context manager – basic open/close
    # ------------------------------------------------------------------
    print("1. Context manager (enter / exit)...")
    with VirtualSerialPair("VCOM_A", "VCOM_B") as pair:
        print(f"   {pair}")
        print(f"   port0: {pair.port0}")
        print(f"   port1: {pair.port1}")
    print(f"   After exit: port0.is_open={pair.port0.is_open}, "
          f"port1.is_open={pair.port1.is_open}")

    # ------------------------------------------------------------------
    # 2. Write → read (exact sizing)
    # ------------------------------------------------------------------
    print("\n2. Write exact payload and read it back...")
    with VirtualSerialPair("A", "B") as p:
        payload = b"Hello, Virtual Serial!\n"
        n = p.port0.write(payload)
        print(f"    Wrote {n} bytes")
        data = p.port1.read(len(payload))
        print(f"    Read: {data!r}")
        assert data == payload, "Mismatch!"
        print("    OK - data matches")

    # ------------------------------------------------------------------
    # 3. Bidirectional
    # ------------------------------------------------------------------
    print("\n3. Bidirectional communication...")
    with VirtualSerialPair("A", "B") as p:
        p.port0.write(b"Ping\n")
        p.port1.write(b"Pong\n")
        print(f"    port1 read: {p.port1.readline()!r}")
        print(f"    port0 read: {p.port0.readline()!r}")

    # ------------------------------------------------------------------
    # 4. Timeout (non-blocking after data exhaustion)
    # ------------------------------------------------------------------
    print("\n4. Timeout behaviour...")
    with VirtualSerialPair("A", "B") as p:
        p.port1.timeout = 0.2
        data = p.port1.read(10)
        print(f"    Read with no data: {data!r} (len={len(data)})")
        assert data == b'', "Expected empty on timeout"

        # Write something and check that read returns it
        p.port0.write(b"XYZ")
        data = p.port1.read(10)
        print(f"    Read after write: {data!r}")
        assert data == b"XYZ"

    # ------------------------------------------------------------------
    # 5. in_waiting
    # ------------------------------------------------------------------
    print("\n5. in_waiting property...")
    with VirtualSerialPair("A", "B") as p:
        p.port0.write(b"ABC")
        print(f"    port1.in_waiting = {p.port1.in_waiting}")
        assert p.port1.in_waiting == 3
        p.port1.read(2)
        print(f"    After read(2): {p.port1.in_waiting}")
        assert p.port1.in_waiting == 1

    # ------------------------------------------------------------------
    # 6. readline
    # ------------------------------------------------------------------
    print("\n6. readline...")
    with VirtualSerialPair("A", "B") as p:
        p.port0.write(b"Line 1\nLine 2\n")
        line1 = p.port1.readline()
        line2 = p.port1.readline()
        print(f"    line1: {line1!r}")
        print(f"    line2: {line2!r}")
        assert line1 == b"Line 1\n"
        assert line2 == b"Line 2\n"

    # ------------------------------------------------------------------
    # 7. Partial read (split large chunk)
    # ------------------------------------------------------------------
    print("\n7. Partial read (chunk splitting)...")
    with VirtualSerialPair("A", "B") as p:
        p.port0.write(b"HELLOWORLD")
        part1 = p.port1.read(5)
        part2 = p.port1.read(5)
        print(f"    read(5) x2: {part1!r} + {part2!r}")
        assert part1 == b"HELLO"
        assert part2 == b"WORLD"

    # ------------------------------------------------------------------
    # 8. create_virtual_pair helper
    # ------------------------------------------------------------------
    print("\n8. create_virtual_pair() helper...")
    vp = create_virtual_pair("COM_A", "COM_B", baudrate=115200)
    print(f"    {vp}")
    print(f"    baudrates: {vp.port0.baudrate} / {vp.port1.baudrate}")
    vp.port0.write(b"Test")
    print(f"    port1.read(4) = {vp.port1.read(4)!r}")
    vp.close()

    # ------------------------------------------------------------------
    # 9. Independent open/close of each port
    # ------------------------------------------------------------------
    print("\n9. Independent open/close...")
    pair2 = VirtualSerialPair("P0", "P1")
    pair2.port0.open()
    print(f"    port0 open={pair2.port0.is_open}, port1 open={pair2.port1.is_open}")
    try:
        pair2.port0.write(b"data")  # peer is closed → should raise
        print("    ERROR: should have raised OSError")
    except OSError as e:
        print(f"    Caught expected error: {e}")
    pair2.port1.open()
    pair2.port0.write(b"data")
    print(f"    After opening port1: port1.in_waiting={pair2.port1.in_waiting}")
    pair2.close()

    # ------------------------------------------------------------------
    # 10. Write return value & counters
    # ------------------------------------------------------------------
    print("\n10. Write return value and counters...")
    with VirtualSerialPair("A", "B") as p:
        n = p.port0.write(b"12345678")
        print(f"    write returned {n}")
        assert n == 8
        print(f"    port0.total_bytes_written={p.port0.total_bytes_written}")
        print(f"    port1.total_bytes_read={p.port1.total_bytes_read}")
        _ = p.port1.read(8)
        print(f"    after read: port1.total_bytes_read={p.port1.total_bytes_read}")

    # ------------------------------------------------------------------
    # 11. read_until with custom terminator
    # ------------------------------------------------------------------
    print("\n11. read_until with custom terminator...")
    with VirtualSerialPair("X", "Y") as p:
        p.port1.timeout = 0.5
        p.port0.write(b"start\x00middle\x00end")
        seg1 = p.port1.read_until(expected=b'\x00')
        seg2 = p.port1.read_until(expected=b'\x00')
        seg3 = p.port1.read_until(expected=b'\x00')
        print(f"    seg1={seg1!r}, seg2={seg2!r}, seg3={seg3!r}")
        assert seg1 == b"start\x00"
        assert seg2 == b"middle\x00"
        assert seg3 == b"end"  # no terminator at EOF

    # ------------------------------------------------------------------
    # 12. Error on closed port
    # ------------------------------------------------------------------
    print("\n12. Error handling...")
    p = VirtualSerialPair("A", "B")
    try:
        p.port0.read(1)
        print("    ERROR: should have raised OSError")
    except OSError as e:
        print(f"    Read on closed port: {e}")
    p.open()
    p.port0.write(b"ok")
    p.close()
    try:
        p.port0.write(b"fail")
        print("    ERROR: should have raised OSError")
    except OSError as e:
        print(f"    Write on closed port: {e}")

    print("\n=== All tests passed ===")
