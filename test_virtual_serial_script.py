#!/usr/bin/env python3
"""
测试脚本：使用 VirtualSerial 类创建一对虚拟串口，
一个发送数据，另一个接收数据，验证数据一致性，并输出测试结果。

该脚本跨平台可用：
- Linux/macOS：使用 virtual_serial_core.VirtualSerial（基于PTY）
- Windows：    使用内置的简易缓冲区虚拟串口实现

用法:
    python test_virtual_serial_script.py
"""

import sys
import os
import time
import threading
from collections import deque


# ============================================================================
# 简易虚拟串口（纯Python缓冲区实现，用于Windows或不支持PTY的平台）
# ============================================================================

class SimpleVirtualSerial:
    """简易虚拟串口，基于内存缓冲区的双向通信."""

    def __init__(self, name="VCOM"):
        self.name = name
        self._buffer: deque = deque()
        self._cond = threading.Condition()
        self._is_open = False
        self._peer: 'SimpleVirtualSerial' = None
        self.timeout = None
        self.bytes_read = 0
        self.bytes_written = 0

    @property
    def is_open(self):
        return self._is_open

    def open(self):
        self._is_open = True

    def close(self):
        self._is_open = False
        with self._cond:
            self._buffer.clear()
            self._cond.notify_all()

    def _check_open(self):
        if not self._is_open:
            raise OSError(f"Port '{self.name}' is not open")

    def write(self, data: bytes) -> int:
        self._check_open()
        if self._peer is None:
            raise OSError(f"Port '{self.name}' has no peer")
        data = bytes(data)
        if not data:
            return 0
        with self._peer._cond:
            self._peer._buffer.append(data)
            self._peer._cond.notify_all()
        self.bytes_written += len(data)
        return len(data)

    def read(self, size: int = 1024) -> bytes:
        self._check_open()
        if size <= 0:
            return b''
        chunks = []
        remaining = size
        deadline = None if self.timeout is None else (time.monotonic() + self.timeout)
        with self._cond:
            while remaining > 0:
                while self._buffer:
                    chunk = self._buffer[0]
                    if len(chunk) <= remaining:
                        self._buffer.popleft()
                        chunks.append(chunk)
                        remaining -= len(chunk)
                    else:
                        chunks.append(chunk[:remaining])
                        self._buffer[0] = chunk[remaining:]
                        remaining = 0
                        break
                if remaining == 0:
                    break
                if self.timeout == 0:
                    break
                if self.timeout is not None:
                    now = time.monotonic()
                    if now >= deadline:
                        break
                    wait = deadline - now
                else:
                    wait = None
                if not self._cond.wait(timeout=wait):
                    break
        data = b''.join(chunks)
        self.bytes_read += len(data)
        return data

    def readline(self) -> bytes:
        """读取一行（直到换行符或超时）."""
        self._check_open()
        buffer = bytearray()
        deadline = None if self.timeout is None else (time.monotonic() + self.timeout)
        with self._cond:
            while True:
                while self._buffer:
                    chunk = self._buffer[0]
                    idx = chunk.find(b'\n')
                    if idx >= 0:
                        # 找到换行符
                        take = chunk[:idx + 1]
                        rest = chunk[idx + 1:]
                        if rest:
                            self._buffer[0] = rest
                        else:
                            self._buffer.popleft()
                        buffer.extend(take)
                        result = bytes(buffer)
                        self.bytes_read += len(result)
                        return result
                    else:
                        self._buffer.popleft()
                        buffer.extend(chunk)
                # 没有数据了
                if self.timeout == 0:
                    break
                if self.timeout is not None:
                    now = time.monotonic()
                    if now >= deadline:
                        break
                    wait = deadline - now
                else:
                    wait = None
                if not self._cond.wait(timeout=wait):
                    break
        result = bytes(buffer)
        self.bytes_read += len(result)
        return result

    @property
    def in_waiting(self):
        with self._cond:
            return sum(len(c) for c in self._buffer)

    def __repr__(self):
        state = "open" if self._is_open else "closed"
        peer = self._peer.name if self._peer else "None"
        return f"SimpleVirtualSerial(name='{self.name}', peer='{peer}', state={state})"


def simple_pair_ports(a: SimpleVirtualSerial, b: SimpleVirtualSerial):
    """配对该两个简易虚拟串口."""
    a._peer = b
    b._peer = a


def simple_create_pair(name_a="COM_A", name_b="COM_B", timeout=None):
    """创建一对已打开并配对的简易虚拟串口."""
    a = SimpleVirtualSerial(name_a)
    b = SimpleVirtualSerial(name_b)
    a.timeout = timeout
    b.timeout = timeout
    simple_pair_ports(a, b)
    a.open()
    b.open()
    return a, b


# ============================================================================
# 尝试导入 PTY 版本的 VirtualSerial
# ============================================================================

USE_PTY = False
VirtualSerial = None
VirtualSerialPair = None
create_virtual_pair = None

try:
    from virtual_serial_core import (
        VirtualSerial as _VirtualSerial,
        VirtualSerialPair as _VirtualSerialPair,
        create_virtual_pair as _create_virtual_pair,
    )
    # 尝试验证能否正常使用（Unix才有pty）
    if sys.platform in ("linux", "darwin", "cygwin"):
        import pty
        USE_PTY = True
        VirtualSerial = _VirtualSerial
        VirtualSerialPair = _VirtualSerialPair
        create_virtual_pair = _create_virtual_pair
        print(f"[INFO] Using PTY-based VirtualSerial (platform: {sys.platform})")
    else:
        print(f"[INFO] PTY not available on {sys.platform}, using SimpleVirtualSerial fallback.")
except ImportError:
    print("[INFO] virtual_serial_core not available, using SimpleVirtualSerial fallback.")
except Exception as e:
    print(f"[INFO] Cannot use PTY VirtualSerial: {e}")
    print("[INFO] Using SimpleVirtualSerial fallback.")


# ============================================================================
# 测试框架
# ============================================================================

PASS_COUNT = 0
FAIL_COUNT = 0


def test_result(name: str, passed: bool, detail: str = ""):
    global PASS_COUNT, FAIL_COUNT
    status = "PASS" if passed else "FAIL"
    if passed:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
    msg = f"  [{status}] {name}"
    if detail:
        msg += f" -- {detail}"
    print(msg)


def assert_eq(actual, expected, test_name: str):
    if actual == expected:
        test_result(test_name, True, f"expected={expected!r}, got={actual!r}")
    else:
        test_result(test_name, False, f"expected={expected!r}, got={actual!r}")


def create_pair(name_a="SENDER", name_b="RECEIVER", timeout=None):
    """创建一个虚拟串口对（自动选择PTY或简易版本）."""
    if USE_PTY:
        return create_virtual_pair(name_a, name_b, timeout=timeout)
    else:
        return simple_create_pair(name_a, name_b, timeout=timeout)


# ============================================================================
# 测试用例
# ============================================================================

def test_basic_write_read():
    """测试1: 基本写入和读取."""
    print("\n" + "=" * 60)
    print("Test 1: Basic Write & Read")
    print("=" * 60)
    sender, receiver = create_pair("SENDER", "RECEIVER", timeout=0.5)
    try:
        payload = b"Hello, Virtual Serial!"
        n = sender.write(payload)
        assert_eq(n, len(payload), "Bytes written")
        data = receiver.read(len(payload))
        assert_eq(data, payload, "Data consistency")
    finally:
        sender.close()
        receiver.close()


def test_bidirectional():
    """测试2: 双向通信."""
    print("\n" + "=" * 60)
    print("Test 2: Bidirectional Communication")
    print("=" * 60)
    a, b = create_pair("A", "B", timeout=0.5)
    try:
        a.write(b"Ping from A\n")
        b.write(b"Pong from B\n")
        assert_eq(b.readline(), b"Ping from A\n", "A -> B")
        assert_eq(a.readline(), b"Pong from B\n", "B -> A")
    finally:
        a.close()
        b.close()


def test_large_data():
    """测试3: 大数据量 (10KB)."""
    print("\n" + "=" * 60)
    print("Test 3: Large Data (10 KB)")
    print("=" * 60)
    sender, receiver = create_pair("S", "R", timeout=1.0)
    try:
        payload = bytes(i % 256 for i in range(10240))
        sender.write(payload)
        received = bytearray()
        while len(received) < len(payload):
            chunk = receiver.read(512)
            if not chunk:
                break
            received.extend(chunk)
        assert_eq(bytes(received), payload, "10KB integrity")
    finally:
        sender.close()
        receiver.close()


def test_timeout():
    """测试4: 超时行为."""
    print("\n" + "=" * 60)
    print("Test 4: Read Timeout")
    print("=" * 60)
    a, b = create_pair("A", "B", timeout=0.3)
    try:
        start = time.monotonic()
        data = a.read(10)
        elapsed = time.monotonic() - start
        assert_eq(data, b"", "Empty read on timeout")
        # 验证确实等待了一段时间（不超过太多）
        test_result("Timeout elapsed < 1s", elapsed < 1.0, f"elapsed={elapsed:.3f}s")
        b.write(b"OK")
        data = a.read(10)
        assert_eq(data, b"OK", "Read after write")
    finally:
        a.close()
        b.close()


def test_binary_data():
    """测试5: 二进制数据 (0x00-0xFF)."""
    print("\n" + "=" * 60)
    print("Test 5: Binary Data (all byte values)")
    print("=" * 60)
    sender, receiver = create_pair("S", "R", timeout=1.0)
    try:
        payload = bytes(range(256))
        sender.write(payload)
        data = receiver.read(256)
        assert_eq(data, payload, "Full byte range")
    finally:
        sender.close()
        receiver.close()


def test_multiple_writes():
    """测试6: 多次写入后一次性读取."""
    print("\n" + "=" * 60)
    print("Test 6: Multiple Writes Before Read")
    print("=" * 60)
    a, b = create_pair("A", "B", timeout=0.5)
    try:
        a.write(b"Hello ")
        a.write(b"World")
        a.write(b"!")
        data = b.read(12)
        assert_eq(data, b"Hello World!", "Accumulated data")
    finally:
        a.close()
        b.close()


def test_in_waiting():
    """测试7: in_waiting 属性."""
    print("\n" + "=" * 60)
    print("Test 7: in_waiting Property")
    print("=" * 60)
    a, b = create_pair("A", "B", timeout=0.5)
    try:
        if hasattr(b, 'in_waiting'):
            assert_eq(b.in_waiting, 0, "Initial in_waiting = 0")
            a.write(b"12345")
            # PTY版本需要稍等一下转发
            time.sleep(0.1)
            waiting = b.in_waiting
            test_result("in_waiting > 0 after write", waiting > 0 or waiting == 5, f"got {waiting}")
        else:
            test_result("in_waiting (skip)", True, "property not available")
    finally:
        a.close()
        b.close()


# ============================================================================
# 主入口
# ============================================================================

def main():
    print("=" * 60)
    print("  Virtual Serial Port Test Suite")
    if USE_PTY:
        print("  Using: PTY-based VirtualSerial (virtual_serial_core)")
    else:
        print("  Using: SimpleVirtualSerial (buffer-based fallback)")
    print("=" * 60)
    print(f"  Platform: {sys.platform}")
    print(f"  Python:   {sys.version.split()[0]}")

    tests = [
        test_basic_write_read,
        test_bidirectional,
        test_large_data,
        test_timeout,
        test_binary_data,
        test_multiple_writes,
        test_in_waiting,
    ]

    for test_func in tests:
        try:
            test_func()
        except Exception as e:
            print(f"\n  [FAIL] {test_func.__doc__} raised: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            global FAIL_COUNT
            FAIL_COUNT += 1

    # 汇总
    print("\n" + "=" * 60)
    print("              Test Summary")
    print("=" * 60)
    total = PASS_COUNT + FAIL_COUNT
    print(f"  Total: {total}   Passed: {PASS_COUNT}   Failed: {FAIL_COUNT}")
    if FAIL_COUNT == 0:
        print("\n  *** All tests passed! ***")
        return 0
    else:
        print(f"\n  *** {FAIL_COUNT} test(s) failed. ***")
        return 1


if __name__ == "__main__":
    sys.exit(main())
