# tests/test_config.py - Unit tests for CLI argument parsing and Application class

"""
Tests for the CLI configuration module (cli.py).

Coverage:
- Argument parser construction and defaults
- Argument validation (choices, types)
- ``Application`` class initialization
- ``Application.cleanup()`` lifecycle
- Signal handling
- Lazy module loading (``_load_virtual_serial``, ``_load_serial_bridge``)
"""

import sys
import os
import argparse
import signal
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cli


# ============================================================================
# Argument Parser Tests
# ============================================================================

class TestArgumentParser:
    """Tests for ``build_argument_parser()``."""

    def test_parser_returns_argparse_parser(self):
        """Should return an ArgumentParser instance."""
        parser = cli.build_argument_parser()
        assert isinstance(parser, argparse.ArgumentParser)

    def test_default_baudrate(self):
        """Default baudrate should be 9600."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.baudrate == 9600

    def test_default_timeout(self):
        """Default timeout should be 1.0."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.timeout == 1.0

    def test_default_bytesize(self):
        """Default bytesize should be 8."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.bytesize == 8

    def test_default_parity(self):
        """Default parity should be 'N'."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.parity == "N"

    def test_default_stopbits(self):
        """Default stopbits should be 1.0."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.stopbits == 1.0

    def test_default_xonxoff_false(self):
        """Default xonxoff should be False."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.xonxoff is False

    def test_default_rtscts_false(self):
        """Default rtscts should be False."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.rtscts is False

    def test_default_no_bridge_false(self):
        """Default no_bridge should be False."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.no_bridge is False

    def test_default_buffer_size(self):
        """Default buffer_size should be 4096."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.buffer_size == 4096

    def test_default_no_cleanup_false(self):
        """Default no_cleanup should be False."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])
        assert args.no_cleanup is False

    def test_baudrate_parsing(self):
        """Custom baudrate should be parsed correctly."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-b", "115200"])
        assert args.baudrate == 115200

    def test_baudrate_long_flag(self):
        """Long flag --baudrate should work."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--baudrate", "38400"])
        assert args.baudrate == 38400

    def test_timeout_parsing(self):
        """Custom timeout should be parsed correctly."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-t", "0.5"])
        assert args.timeout == 0.5

    def test_timeout_non_blocking(self):
        """Timeout of 0 should be allowed (non-blocking)."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-t", "0"])
        assert args.timeout == 0.0

    def test_bytesize_valid_choices(self):
        """Valid bytesize choices should be accepted."""
        parser = cli.build_argument_parser()
        for val in [5, 6, 7, 8]:
            args = parser.parse_args(["--bytesize", str(val)])
            assert args.bytesize == val

    def test_bytesize_invalid_choice(self):
        """Invalid bytesize should raise SystemExit."""
        parser = cli.build_argument_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["--bytesize", "9"])

    def test_parity_valid_choices(self):
        """Valid parity choices should be accepted."""
        parser = cli.build_argument_parser()
        for val in ["N", "E", "O", "M", "S"]:
            args = parser.parse_args(["--parity", val])
            assert args.parity == val

    def test_parity_invalid_choice(self):
        """Invalid parity should raise SystemExit."""
        parser = cli.build_argument_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["--parity", "X"])

    def test_stopbits_valid_choices(self):
        """Valid stopbits choices should be accepted."""
        parser = cli.build_argument_parser()
        for val in [1.0, 1.5, 2.0]:
            args = parser.parse_args(["--stopbits", str(val)])
            assert args.stopbits == val

    def test_stopbits_invalid_choice(self):
        """Invalid stopbits should raise SystemExit."""
        parser = cli.build_argument_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["--stopbits", "3.0"])

    def test_xonxoff_flag(self):
        """--xonxoff should set the flag to True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--xonxoff"])
        assert args.xonxoff is True

    def test_rtscts_flag(self):
        """--rtscts should set the flag to True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--rtscts"])
        assert args.rtscts is True

    def test_no_bridge_flag(self):
        """--no-bridge should set the flag to True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--no-bridge"])
        assert args.no_bridge is True

    def test_no_cleanup_flag(self):
        """--no-cleanup should set the flag to True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--no-cleanup"])
        assert args.no_cleanup is True

    def test_list_flag(self):
        """-l / --list should set the flag to True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-l"])
        assert args.list is True

        args = parser.parse_args(["--list"])
        assert args.list is True

    def test_verbose_flag(self):
        """-v / --verbose should set the flag to True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-v"])
        assert args.verbose is True

    def test_quiet_flag(self):
        """-q / --quiet should set the flag to True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-q"])
        assert args.quiet is True

    def test_port1_custom_name(self):
        """--port1 should accept a custom name."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--port1", "/tmp/myport1"])
        assert args.port1 == "/tmp/myport1"

    def test_port2_custom_name(self):
        """--port2 should accept a custom name."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--port2", "COM10"])
        assert args.port2 == "COM10"

    def test_duration_parsing(self):
        """--duration should accept a float value."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--duration", "30.5"])
        assert args.duration == 30.5

    def test_buffer_size_parsing(self):
        """--buffer-size should accept an integer."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--buffer-size", "8192"])
        assert args.buffer_size == 8192

    def test_combined_arguments(self):
        """Multiple arguments should be parsed together correctly."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([
            "-b", "115200",
            "-t", "0.1",
            "--bytesize", "7",
            "--parity", "E",
            "--stopbits", "2.0",
            "--xonxoff",
            "--rtscts",
            "--port1", "/dev/ttyV0",
            "--port2", "/dev/ttyV1",
            "--buffer-size", "2048",
            "--duration", "60",
            "-v",
        ])
        assert args.baudrate == 115200
        assert args.timeout == 0.1
        assert args.bytesize == 7
        assert args.parity == "E"
        assert args.stopbits == 2.0
        assert args.xonxoff is True
        assert args.rtscts is True
        assert args.port1 == "/dev/ttyV0"
        assert args.port2 == "/dev/ttyV1"
        assert args.buffer_size == 2048
        assert args.duration == 60.0
        assert args.verbose is True

    def test_help_message(self):
        """--help should print help and exit."""
        parser = cli.build_argument_parser()
        with pytest.raises(SystemExit):
            parser.parse_args(["--help"])


# ============================================================================
# Application Class Tests
# ============================================================================

class TestApplication:
    """Tests for the ``Application`` class."""

    @pytest.fixture
    def mock_args(self):
        """Return a mock argparse.Namespace with default values."""
        ns = argparse.Namespace()
        ns.baudrate = 9600
        ns.timeout = 1.0
        ns.bytesize = 8
        ns.parity = "N"
        ns.stopbits = 1.0
        ns.xonxoff = False
        ns.rtscts = False
        ns.port1 = None
        ns.port2 = None
        ns.list = False
        ns.verbose = False
        ns.quiet = False
        ns.no_cleanup = False
        ns.duration = None
        ns.buffer_size = 4096
        ns.no_bridge = False
        return ns

    def test_application_init(self, mock_args):
        """Application should initialize with the given args."""
        app = cli.Application(mock_args)
        assert app.args is mock_args
        assert app.bridge is None
        assert app.virtual_ports is None
        assert app.shutdown_requested is False
        assert app._cleaned_up is False

    def test_cleanup_when_no_bridge_no_ports(self, mock_args):
        """Cleanup with no bridge and no ports should be a no-op."""
        app = cli.Application(mock_args)
        app.cleanup()  # Should not raise
        assert app._cleaned_up is True

    def test_cleanup_is_idempotent(self, mock_args):
        """Calling cleanup multiple times should be safe."""
        app = cli.Application(mock_args)
        app.cleanup()
        app.cleanup()
        app.cleanup()
        assert app._cleaned_up is True

    def test_cleanup_skips_when_no_cleanup_flag(self, mock_args):
        """If --no-cleanup is set, cleanup should be skipped."""
        mock_args.no_cleanup = True
        app = cli.Application(mock_args)
        app.cleanup()
        # No error, but also no real cleanup done
        assert app._cleaned_up is True

    def test_cleanup_stops_bridge_if_present(self, mock_args):
        """If a bridge is attached, its stop() method should be called."""
        mock_bridge = MagicMock()
        mock_bridge.stop.return_value = None

        app = cli.Application(mock_args)
        app.bridge = mock_bridge
        app.cleanup()

        mock_bridge.stop.assert_called_once()
        assert app.bridge is None

    def test_cleanup_closes_bridge_if_no_stop_method(self, mock_args):
        """If bridge has close() but no stop(), close() should be called."""
        mock_bridge = MagicMock(spec=["close"])  # has close but not stop
        mock_bridge.close.return_value = None
        del mock_bridge.stop  # Ensure stop doesn't exist

        # Actually, MagicMock always has attributes unless we use spec
        mock_bridge = MagicMock()
        mock_bridge.close.return_value = None
        # Mock hasattr to return False for 'stop' and True for 'close'
        original_hasattr = hasattr

        def fake_hasattr(obj, name):
            if name == "stop":
                return False
            return original_hasattr(obj, name)

        app = cli.Application(mock_args)
        app.bridge = mock_bridge

        with patch("builtins.hasattr", side_effect=fake_hasattr):
            app.cleanup()

        mock_bridge.close.assert_called_once()
        assert app.bridge is None

    def test_cleanup_handles_bridge_error_gracefully(self, mock_args):
        """If bridge.stop() raises, the error should be logged but not propagated."""
        mock_bridge = MagicMock()
        mock_bridge.stop.side_effect = RuntimeError("Bridge error")

        app = cli.Application(mock_args)
        app.bridge = mock_bridge
        app.cleanup()  # Should not raise

        mock_bridge.stop.assert_called_once()
        assert app.bridge is None

    def test_cleanup_cleans_virtual_ports(self, mock_args, monkeypatch):
        """Virtual ports should be cleaned up via virtual_serial.cleanup."""
        mock_args.port1 = "/dev/ttyV0"
        mock_args.port2 = "/dev/ttyV1"

        mock_vs = MagicMock()
        mock_vs.cleanup.return_value = None

        def fake_load_vs():
            cli._virtual_serial = mock_vs
            return mock_vs

        monkeypatch.setattr(cli, "_load_virtual_serial", fake_load_vs)

        app = cli.Application(mock_args)
        app.virtual_ports = ("/dev/ttyV0", "/dev/ttyV1")
        app.cleanup()

        # virtual_serial.cleanup should have been called with the port tuple
        mock_vs.cleanup.assert_called_once_with(("/dev/ttyV0", "/dev/ttyV1"))
        assert app.virtual_ports is None

    def test_handle_signal_sets_shutdown_flag(self, mock_args):
        """handle_signal should set shutdown_requested and call cleanup."""
        app = cli.Application(mock_args)

        with patch.object(app, "cleanup") as mock_cleanup:
            with pytest.raises(SystemExit):
                app.handle_signal(signal.SIGINT, None)

            assert app.shutdown_requested is True
            mock_cleanup.assert_called_once()

    def test_handle_signal_sigterm(self, mock_args):
        """SIGTERM should also trigger graceful shutdown."""
        app = cli.Application(mock_args)

        with patch.object(app, "cleanup") as mock_cleanup:
            with pytest.raises(SystemExit):
                app.handle_signal(signal.SIGTERM, None)

            assert app.shutdown_requested is True
            mock_cleanup.assert_called_once()


# ============================================================================
# Lazy Module Loading Tests
# ============================================================================

class TestLazyModuleLoading:
    """Tests for lazy-loading helper functions."""

    def test_load_virtual_serial_success(self, monkeypatch):
        """``_load_virtual_serial`` should import and cache the module."""
        # Reset the global cache
        monkeypatch.setattr(cli, "_virtual_serial", None)

        # We can import the real module
        module = cli._load_virtual_serial()
        assert module is not None
        assert cli._virtual_serial is module

        # Second call should return the cached module
        module2 = cli._load_virtual_serial()
        assert module2 is module

    def test_load_virtual_serial_failure(self, monkeypatch):
        """If import fails, sys.exit(1) should be called."""
        monkeypatch.setattr(cli, "_virtual_serial", None)

        # Make the import raise ImportError
        def fake_import(name, *args, **kwargs):
            raise ImportError("No module named 'virtual_serial'")

        # We need to patch builtins.__import__ or use a different approach
        # Since _load_virtual_serial uses 'import virtual_serial as vs',
        # we can mock sys.exit
        with patch.object(cli.sys, "exit") as mock_exit:
            with patch("builtins.__import__", side_effect=ImportError("mock error")):
                cli._load_virtual_serial()
                mock_exit.assert_called_once_with(1)

    def test_load_serial_bridge_success(self, monkeypatch):
        """``_load_serial_bridge`` should import and cache the module."""
        monkeypatch.setattr(cli, "_serial_bridge", None)

        module = cli._load_serial_bridge()
        assert module is not None
        assert cli._serial_bridge is module

    def test_load_serial_bridge_failure(self, monkeypatch):
        """If import fails, sys.exit(1) should be called."""
        monkeypatch.setattr(cli, "_serial_bridge", None)

        with patch.object(cli.sys, "exit") as mock_exit:
            with patch("builtins.__import__", side_effect=ImportError("mock error")):
                cli._load_serial_bridge()
                mock_exit.assert_called_once_with(1)


# ============================================================================
# Integration: Argument Parser + Application
# ============================================================================

class TestParserApplicationIntegration:
    """Integration tests combining argument parsing and Application class."""

    def test_full_workflow_no_errors(self):
        """Parse arguments and create Application without errors."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([
            "-b", "19200",
            "-t", "0.2",
            "--no-bridge",
            "--duration", "10",
        ])
        app = cli.Application(args)
        assert app.args.baudrate == 19200
        assert app.args.timeout == 0.2
        assert app.args.no_bridge is True
        assert app.args.duration == 10.0
        app.cleanup()

    def test_quiet_mode(self):
        """In quiet mode, args.quiet should be True."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-q"])
        assert args.quiet is True
        assert args.verbose is False

    def test_verbose_and_quiet_together(self):
        """Both -v and -q can be set (last one wins conceptually, but both flags are True)."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-v", "-q"])
        assert args.verbose is True
        assert args.quiet is True
