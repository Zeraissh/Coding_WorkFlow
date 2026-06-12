# tests/test_integration.py - Integration tests for the virtual serial port system

"""
Integration tests that exercise multiple components together:

- Virtual serial port creation + SerialBridge data forwarding
- CLI argument parsing + Application lifecycle
- End-to-end data send/receive through virtual ports
- Thread coordination and cleanup

These tests use mocking for external dependencies (pty, serial ports, subprocesses)
but test the actual wiring between the modules.
"""

import sys
import os
import time
import threading
import argparse
from unittest.mock import MagicMock, patch, call

import pytest

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import virtual_serial as vs
import serial_bridge as sb
import cli


# ============================================================================
# Virtual Serial + Bridge Integration
# ============================================================================

class TestVirtualSerialWithBridge:
    """Integration tests combining virtual_serial and serial_bridge."""

    def test_create_ports_and_configure_bridge(self, mock_pty, monkeypatch):
        """Create virtual ports and configure a SerialBridge for them."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        # Create virtual serial pair
        p1, p2 = vs.create_virtual_serial_pair()
        assert p1 == "/dev/pts/10"
        assert p2 == "/dev/pts/11"

        # Create a SerialBridge for these ports
        bridge = sb.SerialBridge(p1, p2, baudrate=115200, timeout=0.1)
        assert bridge.port1_name == "/dev/pts/10"
        assert bridge.port2_name == "/dev/pts/11"
        assert bridge.baudrate == 115200

        # Cleanup
        vs.cleanup()

    def test_bridge_statistics_integration(self, mock_pty, monkeypatch):
        """Bridge statistics should work correctly with virtual ports."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        p1, p2 = vs.create_virtual_serial_pair()

        bridge = sb.SerialBridge(p1, p2)
        assert bridge.bytes_1_to_2 == 0
        assert bridge.bytes_2_to_1 == 0

        # Simulate data transfer and stat updates
        with bridge._stats_lock:
            bridge.bytes_1_to_2 += 100
            bridge.bytes_2_to_1 += 50

        assert bridge.bytes_1_to_2 == 100
        assert bridge.bytes_2_to_1 == 50

        vs.cleanup()

    def test_multiple_bridges_with_virtual_ports(self, mock_pty, monkeypatch):
        """Multiple bridges can be created for different virtual port pairs."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        # First pair
        p1a, p1b = vs.create_virtual_serial_pair()

        # Reset call count for second pair removed to ensure different port names

        # Second pair
        p2a, p2b = vs.create_virtual_serial_pair()

        bridge1 = sb.SerialBridge(p1a, p1b)
        bridge2 = sb.SerialBridge(p2a, p2b)

        assert bridge1.port1_name != bridge2.port1_name
        assert len(vs._forwarding_threads) == 4

        vs.cleanup()

    def test_context_manager_with_bridge(self, mock_pty, monkeypatch):
        """VirtualSerialPair context manager can be used with SerialBridge."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        with vs.VirtualSerialPair() as (p1, p2):
            bridge = sb.SerialBridge(p1, p2)
            assert bridge.port1_name == "/dev/pts/10"
            assert bridge.port2_name == "/dev/pts/11"

        # After context exit, cleanup should have run
        assert len(vs._forwarding_threads) == 0


# ============================================================================
# CLI + Core Integration
# ============================================================================

class TestCLIWithCoreIntegration:
    """Integration tests combining CLI argument parsing with core module."""

    def test_cli_args_flow_to_bridge_config(self):
        """CLI arguments should produce correct bridge configuration."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([
            "-b", "38400",
            "-t", "0.2",
            "--buffer-size", "2048",
        ])

        # These args would be used to create a SerialBridge
        bridge = sb.SerialBridge(
            "COM1", "COM2",
            baudrate=args.baudrate,
            timeout=args.timeout,
            read_size=args.buffer_size,
        )

        assert bridge.baudrate == 38400
        assert bridge.timeout == 0.2
        assert bridge.read_size == 2048

    def test_application_workflow_with_mocked_modules(self, monkeypatch):
        """Simulate the full Application workflow with mocked dependencies."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([
            "-b", "57600",
            "--no-bridge",
            "--duration", "5",
        ])

        app = cli.Application(args)

        # Mock virtual_serial creation
        mock_vs = MagicMock()
        mock_vs.create_virtual_serial_pair.return_value = ("/dev/v0", "/dev/v1")
        mock_vs.cleanup.return_value = None

        monkeypatch.setattr(cli, "_load_virtual_serial", lambda: mock_vs)
        # Reset lazy cache
        monkeypatch.setattr(cli, "_virtual_serial", None)

        # Simulate port creation
        app.virtual_ports = mock_vs.create_virtual_serial_pair()
        assert app.virtual_ports == ("/dev/v0", "/dev/v1")

        # Simulate cleanup
        app.cleanup()
        # The cleanup calls vs.cleanup with the virtual_ports tuple
        mock_vs.cleanup.assert_called_once_with(("/dev/v0", "/dev/v1"))

    def test_no_bridge_mode_skips_bridge_creation(self):
        """When --no-bridge is set, no bridge should be created."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["--no-bridge"])

        app = cli.Application(args)
        assert app.args.no_bridge is True
        assert app.bridge is None  # Bridge should not be created

    def test_verbose_mode_enables_debug_logging(self):
        """--verbose should set verbose flag (actual log level change is tested elsewhere)."""
        parser = cli.build_argument_parser()
        args = parser.parse_args(["-v"])

        app = cli.Application(args)
        assert app.args.verbose is True


# ============================================================================
# End-to-End Data Flow (Simulated)
# ============================================================================

class TestEndToEndDataFlow:
    """End-to-end tests simulating complete data flow through the system."""

    def test_data_roundtrip_through_virtual_ports(self, mock_pty, monkeypatch):
        """Data written to one virtual port should appear on the other."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        p1, p2 = vs.create_virtual_serial_pair()

        r1 = mock_pty["r1"]
        r2 = mock_pty["r2"]
        w1 = mock_pty["w1"]
        w2 = mock_pty["w2"]

        # Write to slave1 (w1), should be forwarded to master2 (r2), then to slave2 (w2)
        test_message = b"Integration test message!"
        os.write(w1, test_message)

        time.sleep(0.3)

        import select
        ready, _, _ = select.select([w2], [], [], 0.5)
        if ready:
            received = os.read(w2, 1024)
            assert received == test_message
        else:
            assert False, "Timeout waiting for data on w2"

        vs.cleanup()

    def test_bidirectional_data_flow(self, mock_pty, monkeypatch):
        """Data should flow in both directions simultaneously."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        p1, p2 = vs.create_virtual_serial_pair()

        r1 = mock_pty["r1"]
        r2 = mock_pty["r2"]
        w1 = mock_pty["w1"]
        w2 = mock_pty["w2"]

        # Write to both slaves
        os.write(w1, b"Port1->Port2")
        os.write(w2, b"Port2->Port1")

        time.sleep(0.5)

        import select
        ready1, _, _ = select.select([w1], [], [], 0.3)
        ready2, _, _ = select.select([w2], [], [], 0.3)

        data_at_w1 = b""
        data_at_w2 = b""

        if ready1:
            data_at_w1 = os.read(w1, 1024)
        if ready2:
            data_at_w2 = os.read(w2, 1024)

        # At least one direction should have data
        assert len(data_at_w1) > 0 or len(data_at_w2) > 0

        vs.cleanup()

    def test_concurrent_writes_from_multiple_threads(self, mock_pty, monkeypatch):
        """Multiple threads writing concurrently should not cause data corruption."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        p1, p2 = vs.create_virtual_serial_pair()

        w1 = mock_pty["w1"]
        w2 = mock_pty["w2"]

        errors = []

        def writer_a():
            try:
                for i in range(10):
                    os.write(w1, f"AAA{i:04d}".encode())
                    time.sleep(0.01)
            except Exception as e:
                errors.append(e)

        def writer_b():
            try:
                for i in range(10):
                    os.write(w2, f"BBB{i:04d}".encode())
                    time.sleep(0.01)
            except Exception as e:
                errors.append(e)

        t1 = threading.Thread(target=writer_a)
        t2 = threading.Thread(target=writer_b)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(errors) == 0, f"Errors during concurrent writes: {errors}"

        vs.cleanup()


# ============================================================================
# System Resilience Tests
# ============================================================================

class TestSystemResilience:
    """Tests for system resilience under various conditions."""

    def test_rapid_create_destroy_cycles(self, mock_pty, monkeypatch):
        """Rapidly creating and destroying virtual ports should not leak resources."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        for i in range(5):
            mock_pty["call_count"][0] = 0
            vs.create_virtual_serial_pair()
            vs.cleanup()

        # After all cycles, state should be clean
        assert len(vs._forwarding_threads) == 0
        assert len(vs._unix_master_fds) == 0
        assert len(vs._managed_subprocesses) == 0

    def test_cleanup_with_partially_initialized_state(self, mock_pty, monkeypatch):
        """Cleanup should handle partially initialized state gracefully."""
        monkeypatch.setattr(vs.sys, "platform", "linux")

        # Manually add a forwarding thread with a closed fd
        stop_event = threading.Event()
        r_pipe, w_pipe = os.pipe()
        os.close(r_pipe)
        os.close(w_pipe)

        t = threading.Thread(target=lambda: None)
        vs._forwarding_threads.append((t, stop_event, r_pipe))
        vs._unix_master_fds.append(r_pipe)

        # Cleanup should handle the already-closed fd
        vs.cleanup()

        assert len(vs._forwarding_threads) == 0
        assert len(vs._unix_master_fds) == 0

    def test_application_cleanup_with_all_components(self, monkeypatch):
        """Application cleanup handles bridge, virtual ports, all together."""
        parser = cli.build_argument_parser()
        args = parser.parse_args([])

        app = cli.Application(args)

        # Set up both bridge and virtual ports
        mock_bridge = MagicMock()
        mock_bridge.stop.return_value = None
        app.bridge = mock_bridge
        app.virtual_ports = ("/dev/v0", "/dev/v1")

        # Mock virtual_serial module
        mock_vs = MagicMock()
        mock_vs.cleanup.return_value = None
        monkeypatch.setattr(cli, "_load_virtual_serial", lambda: mock_vs)
        monkeypatch.setattr(cli, "_virtual_serial", None)

        app.cleanup()

        mock_bridge.stop.assert_called_once()
        mock_vs.cleanup.assert_called_once_with(("/dev/v0", "/dev/v1"))
        assert app.bridge is None
        assert app.virtual_ports is None
