#!/usr/bin/env python3
"""
Data Forwarder Module for Virtual Serial Port Assistant.

Provides transparent bidirectional data forwarding between two serial ports
with support for hexadecimal display and log callbacks.

Example usage::

    import serial
    from data_forwarder import DataForwarder

    ser_a = serial.Serial('/dev/pts/3', 9600, timeout=0.1)
    ser_b = serial.Serial('/dev/pts/4', 9600, timeout=0.1)

    fwd = DataForwarder(ser_a, ser_b, hex_display=True,
                        log_callback=lambda d, p, b: print(f"[{d}] {len(b)} bytes"))

    fwd.start()
    # ... data flows transparently between the two ports ...
    fwd.stop()
"""

import threading
import time
import logging
from typing import Callable, Optional, Union

try:
    import serial
except ImportError:
    serial = None  # Graceful degradation – will raise on first use

logger = logging.getLogger(__name__)


class DataForwarder:
    """
    Bidirectional data forwarder between two serial ports.

    Reads data from one serial port and writes it to the other, and vice versa.
    Supports optional hexadecimal display and log callbacks for monitoring traffic.

    The forwarder runs two daemon threads (one per direction) so that ``start()``
    returns immediately and forwarding proceeds in the background.
    """

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def __init__(
        self,
        port_a: Union[str, "serial.Serial"],
        port_b: Union[str, "serial.Serial"],
        hex_display: bool = False,
        log_callback: Optional[Callable[[str, str, bytes], None]] = None,
        buffer_size: int = 4096,
        read_timeout: float = 0.1,
        reconnect_delay: float = 1.0,
    ):
        """
        Initialize the DataForwarder.

        Args:
            port_a:
                First serial port.  Accepts either:
                - A ``str`` path (e.g. ``"COM3"`` or ``"/dev/pts/5"``) which
                  will be opened automatically in ``start()``.
                - An existing ``serial.Serial`` instance.  If not already
                  open, ``start()`` will call ``.open()`` on it.

            port_b:
                Second serial port, same format as *port_a*.

            hex_display:
                If ``True``, log data in hexadecimal format (e.g. ``"48 65 6C 6C 6F"``).
                If ``False``, log the raw bytes.  Defaults to ``False``.

            log_callback:
                Optional callable invoked on every data transfer.  Signature::

                    callback(direction: str, port_name: str, data: bytes) -> None

                - *direction* is ``"A->B"`` or ``"B->A"``.
                - *port_name* is the source port's name.
                - *data* is the raw bytes transferred.

                If the callback raises an exception it is caught and logged;
                it will not interrupt forwarding.

            buffer_size:
                Maximum number of bytes to read in one ``read()`` call.
                Defaults to 4096.

            read_timeout:
                Serial-port read timeout (seconds) used when the forwarder
                opens ports itself.  Defaults to 0.1.

            reconnect_delay:
                Seconds to wait before attempting to reopen a port that was
                closed unexpectedly.  Defaults to 1.0.
        """
        # Port specifications (may be strings or Serial objects)
        self._port_a = port_a
        self._port_b = port_b

        # Configuration
        self._hex_display = hex_display
        self._log_callback = log_callback
        self._buffer_size = buffer_size
        self._read_timeout = read_timeout
        self._reconnect_delay = reconnect_delay

        # Runtime state
        self._running: bool = False
        self._stop_event = threading.Event()
        self._thread_a_to_b: Optional[threading.Thread] = None
        self._thread_b_to_a: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        # Serial objects (resolved in start())
        self._ser_a: Optional["serial.Serial"] = None
        self._ser_b: Optional["serial.Serial"] = None

        # Flags to track ownership (we opened them, so we close them)
        self._owned_a: bool = False
        self._owned_b: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        """``True`` if the forwarder is currently running."""
        return self._running

    @property
    def hex_display(self) -> bool:
        """Get or set hex-display mode.  Safe to change while running."""
        return self._hex_display

    @hex_display.setter
    def hex_display(self, value: bool) -> None:
        with self._lock:
            self._hex_display = value

    @property
    def port_a_name(self) -> str:
        """Human-readable name for port A."""
        if self._ser_a is not None:
            return self._ser_a.port
        if isinstance(self._port_a, str):
            return self._port_a
        return str(self._port_a)

    @property
    def port_b_name(self) -> str:
        """Human-readable name for port B."""
        if self._ser_b is not None:
            return self._ser_b.port
        if isinstance(self._port_b, str):
            return self._port_b
        return str(self._port_b)

    # ------------------------------------------------------------------
    # start / stop
    # ------------------------------------------------------------------

    def start(self) -> None:
        """
        Start bidirectional data forwarding between port A and port B.

        * If a port was given as a string path, a ``serial.Serial`` object is
          created and opened automatically (with *read_timeout* applied).
        * If a port was given as a ``serial.Serial`` instance and it is not
          already open, ``.open()`` is called.

        Two daemon threads are spawned:
          - **A→B** reads from port A and writes to port B.
          - **B→A** reads from port B and writes to port A.

        Raises:
            RuntimeError:
                If the forwarder is already running.
            ImportError:
                If ``pyserial`` is not installed and a string path was given.
            serial.SerialException:
                If a serial port cannot be opened.
        """
        if self._running:
            raise RuntimeError("DataForwarder is already running")

        self._stop_event.clear()

        # ---------- Resolve port A ----------
        if isinstance(self._port_a, str):
            if serial is None:
                raise ImportError(
                    "pyserial is required to open serial ports by name. "
                    "Install it with:  pip install pyserial"
                )
            self._ser_a = serial.Serial(self._port_a, timeout=self._read_timeout)
            self._owned_a = True
        else:
            self._ser_a = self._port_a
            self._owned_a = False
            if not self._ser_a.is_open:
                self._ser_a.open()

        # ---------- Resolve port B ----------
        if isinstance(self._port_b, str):
            if serial is None:
                # Clean up port A if we opened it
                if self._owned_a:
                    try:
                        self._ser_a.close()
                    except Exception:
                        pass
                    self._ser_a = None
                    self._owned_a = False
                raise ImportError(
                    "pyserial is required to open serial ports by name. "
                    "Install it with:  pip install pyserial"
                )
            self._ser_b = serial.Serial(self._port_b, timeout=self._read_timeout)
            self._owned_b = True
        else:
            self._ser_b = self._port_b
            self._owned_b = False
            if not self._ser_b.is_open:
                try:
                    self._ser_b.open()
                except Exception:
                    # Clean up port A if we opened it
                    if self._owned_a:
                        try:
                            self._ser_a.close()
                        except Exception:
                            pass
                        self._ser_a = None
                        self._owned_a = False
                    raise

        self._running = True

        # ---------- Launch forwarding threads ----------
        self._thread_a_to_b = threading.Thread(
            target=self._forward_loop,
            args=(self._ser_a, self._ser_b, "A->B"),
            name="Fwd-A2B",
            daemon=True,
        )
        self._thread_b_to_a = threading.Thread(
            target=self._forward_loop,
            args=(self._ser_b, self._ser_a, "B->A"),
            name="Fwd-B2A",
            daemon=True,
        )

        self._thread_a_to_b.start()
        self._thread_b_to_a.start()

        logger.info(
            "DataForwarder started: %s <-> %s",
            self._ser_a.port, self._ser_b.port,
        )

    def stop(self, timeout: float = 2.0) -> None:
        """
        Stop data forwarding and release resources.

        * Signals both forwarding threads to exit.
        * Waits up to *timeout* seconds for each thread to join.
        * Closes any serial ports that were automatically opened in ``start()``.
          Ports that were passed as pre-existing ``serial.Serial`` objects are
          left open (the caller owns them).

        This method is idempotent – calling it multiple times is safe.

        Args:
            timeout:
                Maximum seconds to wait for each forwarding thread to finish.
                Defaults to 2.0.
        """
        if not self._running:
            return

        logger.info("Stopping DataForwarder...")
        self._stop_event.set()
        self._running = False

        # Join threads
        for thread in (self._thread_a_to_b, self._thread_b_to_a):
            if thread is not None and thread.is_alive():
                thread.join(timeout=timeout)

        self._thread_a_to_b = None
        self._thread_b_to_a = None

        # Close owned ports
        if self._owned_a and self._ser_a is not None and self._ser_a.is_open:
            try:
                self._ser_a.close()
            except Exception as e:
                logger.warning("Error closing port A: %s", e)
        if self._owned_b and self._ser_b is not None and self._ser_b.is_open:
            try:
                self._ser_b.close()
            except Exception as e:
                logger.warning("Error closing port B: %s", e)

        self._ser_a = None
        self._ser_b = None
        self._owned_a = False
        self._owned_b = False

        logger.info("DataForwarder stopped")

    # ------------------------------------------------------------------
    # Internal: forwarding loop
    # ------------------------------------------------------------------

    def _forward_loop(
        self,
        src: "serial.Serial",
        dst: "serial.Serial",
        direction: str,
    ) -> None:
        """
        Main forwarding loop: read from *src* and write to *dst*.

        Runs in a dedicated daemon thread until the stop event is set.

        Args:
            src: Source serial port.
            dst: Destination serial port.
            direction: Label used in logging (``"A->B"`` or ``"B->A"``).
        """
        logger.debug("Forwarding thread %s started", direction)

        while not self._stop_event.is_set():
            try:
                # Ensure source port is open; attempt reopen if not
                if not src.is_open:
                    logger.warning(
                        "%s: source port %s closed – attempting reopen...",
                        direction, src.port,
                    )
                    try:
                        src.open()
                    except Exception as e:
                        logger.error(
                            "%s: failed to reopen %s: %s",
                            direction, src.port, e,
                        )
                        time.sleep(self._reconnect_delay)
                        continue

                # Check for available data (non-blocking)
                waiting = src.in_waiting
                if waiting > 0:
                    data = src.read(min(waiting, self._buffer_size))
                    if data:
                        # Forward to destination
                        dst.write(data)
                        dst.flush()

                        # Notify listeners
                        self._log_transfer(direction, src.port, data)
                else:
                    # Brief sleep to avoid busy-waiting
                    time.sleep(0.01)

            except serial.SerialException as e:
                logger.error("%s: serial error – %s", direction, e)
                time.sleep(self._reconnect_delay)
            except OSError as e:
                logger.error("%s: OS error – %s", direction, e)
                time.sleep(self._reconnect_delay)
            except Exception as e:
                logger.error("%s: unexpected error – %s", direction, e)
                time.sleep(self._reconnect_delay)

        logger.debug("Forwarding thread %s exited", direction)

    # ------------------------------------------------------------------
    # Internal: logging / callback
    # ------------------------------------------------------------------

    def _log_transfer(self, direction: str, port_name: str, data: bytes) -> None:
        """
        Invoke the user's *log_callback* (if set) and emit a DEBUG log record.

        Args:
            direction: ``"A->B"`` or ``"B->A"``.
            port_name: Name of the source port.
            data: Raw bytes that were transferred.
        """
        # Fire callback
        if self._log_callback is not None:
            try:
                self._log_callback(direction, port_name, data)
            except Exception as e:
                logger.warning("Log callback error: %s", e)

        # Internal debug logging
        if logger.isEnabledFor(logging.DEBUG):
            with self._lock:
                hd = self._hex_display
            if hd:
                hex_str = self._format_hex(data)
                logger.debug(
                    "%s [%s] %d bytes: %s",
                    direction, port_name, len(data), hex_str,
                )
            else:
                logger.debug(
                    "%s [%s] %d bytes: %r",
                    direction, port_name, len(data), data,
                )

    # ------------------------------------------------------------------
    # Static helpers (hex utilities)
    # ------------------------------------------------------------------

    @staticmethod
    def _format_hex(data: bytes) -> str:
        """
        Format bytes as a space-separated uppercase hex string.

        Example::

            b'\\x00\\x1B\\xFF'  →  "00 1B FF"
        """
        return " ".join(f"{b:02X}" for b in data)

    @staticmethod
    def format_hex(data: bytes) -> str:
        """
        Public static method: format bytes as a hex string.

        >>> DataForwarder.format_hex(b'Hello')
        '48 65 6C 6C 6F'
        """
        return DataForwarder._format_hex(data)

    @staticmethod
    def parse_hex(hex_str: str) -> bytes:
        """
        Parse a hex string (space-separated or compact) into bytes.

        >>> DataForwarder.parse_hex("48 65 6C 6C 6F")
        b'Hello'
        >>> DataForwarder.parse_hex("48656C6C6F")
        b'Hello'

        Raises:
            ValueError: If the string has an odd number of hex digits.
        """
        cleaned = hex_str.replace(" ", "").replace("0x", "").replace("0X", "")
        if len(cleaned) % 2 != 0:
            raise ValueError("Hex string must have an even number of characters")
        return bytes.fromhex(cleaned)

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        status = "running" if self._running else "stopped"
        return (
            f"<DataForwarder("
            f"{self.port_a_name} <-> {self.port_b_name}"
            f") [{status}]>"
        )


# ------------------------------------------------------------------
# Convenience factory
# ------------------------------------------------------------------

def create_forwarder(
    port_a: Union[str, "serial.Serial"],
    port_b: Union[str, "serial.Serial"],
    hex_display: bool = False,
    log_callback: Optional[Callable[[str, str, bytes], None]] = None,
    buffer_size: int = 4096,
    read_timeout: float = 0.1,
) -> DataForwarder:
    """
    Create and **start** a ``DataForwarder`` in one call.

    Returns the running ``DataForwarder`` instance.  Call ``.stop()`` on it
    when you are done.

    Args:
        port_a: First serial port (path or ``Serial`` object).
        port_b: Second serial port (path or ``Serial`` object).
        hex_display: Enable hex-display logging.
        log_callback: Optional data transfer callback.
        buffer_size: Max bytes per read.
        read_timeout: Timeout for auto-opened serial ports.

    Returns:
        A started ``DataForwarder`` instance.
    """
    fwd = DataForwarder(
        port_a=port_a,
        port_b=port_b,
        hex_display=hex_display,
        log_callback=log_callback,
        buffer_size=buffer_size,
        read_timeout=read_timeout,
    )
    fwd.start()
    return fwd


# ------------------------------------------------------------------
# Smoke test / Standalone usage
# ------------------------------------------------------------------

if __name__ == "__main__":
    """
    Standalone test::

        python data_forwarder.py <port_a> <port_b> [--hex]

    Example (Linux with socat)::

        # In terminal 1 (create pair):
        socat -d -d pty,raw,echo=0 pty,raw,echo=0

        # In terminal 2 (bridge them):
        python data_forwarder.py /dev/pts/3 /dev/pts/4 --hex
    """
    import sys
    import signal

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    def log_cb(direction: str, port: str, data: bytes) -> None:
        """Print each transfer with hex representation."""
        hex_data = DataForwarder.format_hex(data)
        # Try to show printable ASCII as well
        ascii_repr = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
        print(f"[{direction}] {port} | {len(data):4d} B | {hex_data} | {ascii_repr}")

    if len(sys.argv) < 3:
        print("Usage:   python data_forwarder.py <port_a> <port_b> [--hex]")
        print("Example: python data_forwarder.py COM3 COM4 --hex")
        print("         python data_forwarder.py /dev/pts/3 /dev/pts/4 --hex")
        sys.exit(1)

    port_a = sys.argv[1]
    port_b = sys.argv[2]
    use_hex = "--hex" in sys.argv

    fwd = DataForwarder(
        port_a=port_a,
        port_b=port_b,
        hex_display=use_hex,
        log_callback=log_cb,
    )

    # Wire up graceful shutdown
    def shutdown(signum=None, frame=None):
        print("\nShutting down...")
        fwd.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Start forwarding
    try:
        fwd.start()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

    print(f"Forwarding: {fwd.port_a_name} <-> {fwd.port_b_name}")
    print("Press Ctrl+C to stop.\n")

    # Keep alive until interrupted
    try:
        while fwd.is_running:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        fwd.stop()
        print("Done.")
