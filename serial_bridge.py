#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serial_bridge.py -- Bidirectional Serial Port Data Forwarding Module
"""

import sys
import time
import threading
import logging
from typing import Optional

import serial


# --------------------------------------------------------------------------
# Logging Configuration
# --------------------------------------------------------------------------
logger = logging.getLogger("serial_bridge")
logger.addHandler(logging.StreamHandler())
logger.setLevel(logging.INFO)

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
DEFAULT_READ_SIZE = 1024
DEFAULT_RECONNECT_DELAY = 0.1


class SerialBridge:
    """Manage a pair of serial ports for bidirectional forwarding."""

    def __init__(self, port1: str, port2: str,
                 baudrate: int = 9600,
                 timeout: float = 0.5,
                 read_size: int = DEFAULT_READ_SIZE):
        self.port1_name = port1
        self.port2_name = port2
        self.baudrate = baudrate
        self.timeout = timeout
        self.read_size = read_size

        # Runtime objects
        self.ser1: Optional[serial.Serial] = None
        self.ser2: Optional[serial.Serial] = None
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []

        # Statistics
        self.bytes_1_to_2 = 0
        self.bytes_2_to_1 = 0
        self._stats_lock = threading.Lock()

