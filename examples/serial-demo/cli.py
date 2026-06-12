#!/usr/bin/env python3
"""
Virtual Serial Port CLI - Command Line Interface Tool

A cross-platform tool for creating virtual serial port pairs and
bridging data between them bidirectionally. This is useful for
testing serial communication applications without physical hardware.

Usage:
    python cli.py [options]

Examples:
    python cli.py
    python cli.py --baudrate 115200 --timeout 0.5
    python cli.py --list
    python cli.py --port1 /tmp/vser1 --port2 /tmp/vser2
    python cli.py --no-bridge --duration 30
"""

import argparse
import atexit
import logging
import os
import signal
import sys
import time
from typing import Optional, Tuple, Any

# Configure logging
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)


# --- Module Loading -----------------------------------------------------------

# These are loaded lazily to allow --help to work without dependencies
_virtual_serial = None
_serial_bridge = None

def _load_virtual_serial():
    """Lazily load the virtual_serial module."""
    global _virtual_serial
    if _virtual_serial is None:
        try:
            import virtual_serial as vs
            _virtual_serial = vs
        except ImportError:
            logger.error(
                "virtual_serial module not found. "
                "Please ensure virtual_serial.py is in the current directory."
            )
            sys.exit(1)
    return _virtual_serial

def _load_serial_bridge():
    """Lazily load the serial_bridge module."""
    global _serial_bridge
    if _serial_bridge is None:
        try:
            import serial_bridge as sb
            _serial_bridge = sb
        except ImportError:
            logger.error(
                "serial_bridge module not found. "
                "Please ensure serial_bridge.py is in the current directory."
            )
            sys.exit(1)
    return _serial_bridge


# --- Argument Parser ----------------------------------------------------------

def build_argument_parser() -> argparse.ArgumentParser:
    """Build and return the argument parser for the CLI."""
    parser = argparse.ArgumentParser(
        prog="virtual-serial",
        description=(
            "Create a pair of virtual serial ports and bridge data "
            "between them bidirectionally. This is useful for testing "
            "serial communication applications without physical hardware."
        ),
        epilog=(
            "Examples:\n"
            "  %(prog)s                                    # Use defaults\n"
            "  %(prog)s --baudrate 115200 --timeout 0.5    # Custom settings\n"
            "  %(prog)s --list                              # List ports\n"
            "  %(prog)s --no-bridge --duration 30           # Create ports without bridge"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    # Serial Port Configuration
    serial_group = parser.add_argument_group("Serial Port Configuration")
    serial_group.add_argument(
        "-b", "--baudrate",
        type=int,
        default=9600,
        help="Baud rate for the virtual serial ports (default: 9600)"
    )
    serial_group.add_argument(
        "-t", "--timeout",
        type=float,
        default=1.0,
        help="Read timeout in seconds (default: 1.0, 0 = non-blocking)"
    )
    serial_group.add_argument(
        "--bytesize",
        type=int,
        default=8,
        choices=[5, 6, 7, 8],
        help="Number of data bits (default: 8)"
    )
    serial_group.add_argument(
        "--parity",
        type=str,
        default="N",
        choices=["N", "E", "O", "M", "S"],
        help="Parity: N=None, E=Even, O=Odd, M=Mark, S=Space (default: N)"
    )
    serial_group.add_argument(
        "--stopbits",
        type=float,
        default=1.0,
        choices=[1.0, 1.5, 2.0],
        help="Number of stop bits (default: 1.0)"
    )
    serial_group.add_argument(
        "--xonxoff",
        action="store_true",
        default=False,
        help="Enable software flow control (XON/XOFF)"
    )
    serial_group.add_argument(
        "--rtscts",
        action="store_true",
        default=False,
        help="Enable hardware flow control (RTS/CTS)"
    )

    # Port Naming
    port_group = parser.add_argument_group("Port Naming")
    port_group.add_argument(
        "--port1",
        type=str,
        default=None,
        help="Custom name/path for the first virtual port (default: auto-generated)"
    )
    port_group.add_argument(
        "--port2",
        type=str,
        default=None,
        help="Custom name/path for the second virtual port (default: auto-generated)"
    )

    # Operational Modes
    mode_group = parser.add_argument_group("Operational Modes")
    mode_group.add_argument(
        "-l", "--list",
        action="store_true",
        default=False,
        help="List available virtual serial ports and exit"
    )
    mode_group.add_argument(
        "-v", "--verbose",
        action="store_true",
        default=False,
        help="Enable verbose/debug logging"
    )
    mode_group.add_argument(
        "-q", "--quiet",
        action="store_true",
        default=False,
        help="Suppress all non-error output"
    )
    mode_group.add_argument(
        "--no-cleanup",
        action="store_true",
        default=False,
        help="Do not clean up virtual ports on exit (useful for debugging)"
    )
    mode_group.add_argument(
        "--duration",
        type=float,
        default=None,
        help="Run for a specified duration (in seconds) then exit automatically"
    )

    # Bridge Configuration
    bridge_group = parser.add_argument_group("Bridge Configuration")
    bridge_group.add_argument(
        "--buffer-size",
        type=int,
        default=4096,
        help="Size of the read/write buffer in bytes (default: 4096)"
    )
    bridge_group.add_argument(
        "--no-bridge",
        action="store_true",
        default=False,
        help="Create virtual ports but do NOT start the data bridge"
    )

    return parser


# --- Application Class --------------------------------------------------------

class Application:
    """Manages the lifecycle of the virtual serial application."""

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.bridge: Optional[Any] = None
        self.virtual_ports: Optional[Tuple[str, str]] = None
        self.shutdown_requested = False
        self._cleaned_up = False

    def handle_signal(self, signum, frame):
        """Handle termination signals (SIGINT, SIGTERM)."""
        sig_name = signal.Signals(signum).name
        logger.info(f"Received {sig_name}. Shutting down gracefully...")
        self.shutdown_requested = True
        self.cleanup()
        sys.exit(0)

    def cleanup(self):
        """Clean up resources: stop bridge, close virtual ports."""
        if self._cleaned_up:
            return
        self._cleaned_up = True

        if self.args.no_cleanup:
            logger.info("Skipping cleanup (--no-cleanup was specified).")
            return

        logger.info("Cleaning up resources...")

        # Stop the serial bridge if it was started
        if self.bridge is not None:
            try:
                if hasattr(self.bridge, "stop"):
                    self.bridge.stop()
                    logger.info("Serial bridge stopped.")
                elif hasattr(self.bridge, "close"):
                    self.bridge.close()
                    logger.info("Serial bridge closed.")
            except Exception as e:
                logger.error(f"Error stopping serial bridge: {e}")
            self.bridge = None

        # Clean up virtual ports
        if self.virtual_ports is not None:
            try:
                vs = _load_virtual_serial()
                if hasattr(vs, "cleanup"):
                    vs.cleanup(self.virtual_ports)
                    logger.info("Virtual serial ports cleaned up.")
                elif hasattr(vs, "remove_virtual_serial_pair"):
                    vs.remove_virtual_serial_pair(*self.virtual_ports)
                    logger.info("Virtual serial ports removed.")
            except Exception as e:
                logger.error(f"Error cleaning up virtual ports: {e}")
            self.virtual_ports = None
