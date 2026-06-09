# USAGE.md — 虚拟串口助手 详细使用说明

本文档提供虚拟串口助手 (Virtual Serial Port Assistant) 的详细使用说明和示例。

---

## 目录

1. [命令行接口总览](#1-命令行接口总览)
2. [创建虚拟串口对](#2-创建虚拟串口对)
3. [配置串口参数](#3-配置串口参数)
4. [数据收发](#4-数据收发)
5. [数据转发](#5-数据转发)
6. [交互式菜单模式](#6-交互式菜单模式)
7. [Python API 使用](#7-python-api-使用)
8. [平台特定说明](#8-平台特定说明)
9. [常见问题](#9-常见问题)
10. [实战示例](#10-实战示例)

---

## 1. 命令行接口总览

本工具提供 `python -m virtual_serial_assistant` 作为主入口，支持以下子命令：

| 子命令 | 说明 |
|--------|------|
| `create` | 创建一对虚拟串口 |
| `list` | 列出系统中可用的串口 |
| `config` | 查看或修改串口参数 |
| `send` | 向指定串口发送数据 |
| `monitor` | 监听并显示串口接收到的数据 |
| `forward` | 在两个串口之间实时转发数据 |
| `loopback` | 创建回环测试（自发自收） |
| `interactive` | 进入交互式菜单模式 |

全局选项：

```
-h, --help      显示帮助信息
-v, --version   显示版本号
--verbose       输出详细日志
```

---

## 2. 创建虚拟串口对

### 2.1 基本用法

```bash
# 自动创建（系统分配端口名）
python -m virtual_serial_assistant create

# 指定端口名（Unix 上为符号链接路径）
python -m virtual_serial_assistant create --port1 /tmp/vcom1 --port2 /tmp/vcom2

# Windows 上指定 COM 端口别名
python -m virtual_serial_assistant create --port1 COM5 --port2 COM6
```

### 2.2 使用 Python API

```python
from virtual_serial_assistant import create_virtual_serial_pair, cleanup

# 创建虚拟串口对
port1, port2 = create_virtual_serial_pair()
print(f"端口 1: {port1}")
print(f"端口 2: {port2}")

# ... 使用串口进行通信 ...

# 清理资源
cleanup()
```

### 2.3 使用上下文管理器（推荐）

```python
from virtual_serial_assistant import VirtualSerialPair

with VirtualSerialPair() as (port1, port2):
    # 在 with 块内使用虚拟串口
    import serial
    ser1 = serial.Serial(port1, 9600, timeout=1)
    ser2 = serial.Serial(port2, 9600, timeout=1)
    
    ser1.write(b"Hello from port1!")
    data = ser2.read(100)
    print(f"Port2 接收到: {data}")
    
    ser1.close()
    ser2.close()
# 退出 with 块后自动清理资源
```

### 2.4 工作原理

```
┌──────────────┐         ┌──────────────┐
│  应用程序 A   │ ──写──> │  虚拟串口 1   │
│  (e.g. 终端)  │ <──读── │  /dev/pts/5  │
└──────────────┘         └──────┬───────┘
                                │  内部转发
                                │  (双向)
┌──────────────┐         ┌──────┴───────┐
│  应用程序 B   │ <──读── │  虚拟串口 2   │
│  (e.g. 终端)  │ ──写──> │  /dev/pts/6  │
└──────────────┘         └──────────────┘
```

两个虚拟串口之间通过内部线程（Unix PTY）或外部进程（socat/com0com）进行双向数据转发，任一端写入的数据都能在另一端被读取到。

---

## 3. 配置串口参数

### 3.1 查看当前配置

```bash
# 查看指定串口的当前参数
python -m virtual_serial_assistant config --port /dev/pts/5

# 输出示例：
# Port: /dev/pts/5
#   Baud Rate: 9600
#   Data Bits: 8
#   Stop Bits: 1
#   Parity: None
#   Flow Control: None
```

### 3.2 修改串口参数

```bash
# 设置波特率为 115200
python -m virtual_serial_assistant config --port /dev/pts/5 --baud 115200

# 设置 8N1（8 数据位、无校验、1 停止位）
python -m virtual_serial_assistant config --port /dev/pts/5 --data 8 --parity N --stop 1

# 启用硬件流控
python -m virtual_serial_assistant config --port /dev/pts/5 --flow hardware
```

### 3.3 Python API

```python
from virtual_serial_assistant import SerialConfig

# 创建配置对象
config = SerialConfig(
    baudrate=115200,
    bytesize=8,
    parity='N',
    stopbits=1,
    flow_control='none'
)

# 应用到串口
from virtual_serial_assistant import configure_port
configure_port('/dev/pts/5', config)

# 读取当前配置
current = SerialConfig.from_port('/dev/pts/5')
print(current)
```

---

## 4. 数据收发

### 4.1 发送数据

```bash
# 发送文本数据
python -m virtual_serial_assistant send --port /dev/pts/5 --data "Hello, Serial!"

# 发送十六进制数据
python -m virtual_serial_assistant send --port /dev/pts/5 --hex "48 65 6C 6C 6F"

# 从文件读取并发送
python -m virtual_serial_assistant send --port /dev/pts/5 --file data.bin

# 循环发送（每 500ms 发送一次）
python -m virtual_serial_assistant send --port /dev/pts/5 --data "PING" --repeat 10 --interval 0.5

# 发送并等待响应
python -m virtual_serial_assistant send --port /dev/pts/5 --data "AT\r\n" --expect "OK" --timeout 5
```

### 4.2 监听数据（串口监视器）

```bash
# 基本监听
python -m virtual_serial_assistant monitor --port /dev/pts/5 --baud 9600

# 以十六进制显示
python -m virtual_serial_assistant monitor --port /dev/pts/5 --hex

# 同时显示文本和十六进制
python -m virtual_serial_assistant monitor --port /dev/pts/5 --format both

# 带时间戳
python -m virtual_serial_assistant monitor --port /dev/pts/5 --timestamp

# 记录到文件
python -m virtual_serial_assistant monitor --port /dev/pts/5 --log serial_log.txt

# 过滤特定数据
python -m virtual_serial_assistant monitor --port /dev/pts/5 --filter "ERROR"
```

### 4.3 交互式收发

```bash
# 进入交互式收发模式（类似串口终端）
python -m virtual_serial_assistant terminal --port /dev/pts/5 --baud 115200

# 在交互模式中：
#   - 直接输入文本并按回车发送
#   - :hex 切换到十六进制发送模式
#   - :text 切换回文本模式
#   - :baud 115200 切换波特率
#   - :quit 或 Ctrl+C 退出
```

### 4.4 Python API

```python
from virtual_serial_assistant import SerialMonitor, send_data

# 发送数据
send_data('/dev/pts/5', b'Hello World!', baudrate=9600)

# 持续监听
monitor = SerialMonitor('/dev/pts/5', baudrate=115200)
monitor.on_data(lambda data: print(f"收到: {data.hex()}"))
monitor.start()

# 停止监听
monitor.stop()
```

---

## 5. 数据转发

### 5.1 基本转发

```bash
# 双向转发（source <-> target）
python -m virtual_serial_assistant forward --source COM1 --target COM2 --baud 9600

# 单向转发（仅 source -> target）
python -m virtual_serial_assistant forward --source COM1 --target COM2 --direction source-to-target

# 使用不同波特率
python -m virtual_serial_assistant forward --source COM1 --source-baud 9600 --target COM2 --target-baud 115200
```

### 5.2 高级转发选项

```bash
# 添加时间戳前缀
python -m virtual_serial_assistant forward --source COM1 --target COM2 --timestamp

# 记录转发的所有数据
python -m virtual_serial_assistant forward --source COM1 --target COM2 --log forward.log

# 数据过滤（仅转发包含特定内容的数据）
python -m virtual_serial_assistant forward --source COM1 --target COM2 --filter "DATA:"

# 数据修改（使用 sed 风格替换）
python -m virtual_serial_assistant forward --source COM1 --target COM2 --replace "foo:bar"

# 十六进制转发模式
python -m virtual_serial_assistant forward --source COM1 --target COM2 --hex
```

### 5.3 Python API

```python
from virtual_serial_assistant import SerialForwarder

# 创建转发器
forwarder = SerialForwarder(
    source='COM1',
    target='/dev/pts/5',
    source_baud=9600,
    target_baud=115200,
    bidirectional=True
)

# 设置数据回调
def on_forward(direction, data):
    print(f"[{direction}] {data.hex()}")

forwarder.on_forward = on_forward

# 启动转发
forwarder.start()

# ... 运行一段时间后停止 ...
forwarder.stop()
```

---

## 6. 交互式菜单模式

如果不想记忆命令行参数，可以使用交互式菜单：

```bash
python -m virtual_serial_assistant interactive
```

进入后将看到菜单：

```
╔══════════════════════════════════════════╗
║     虚拟串口助手 - 交互式菜单           ║
╠══════════════════════════════════════════╣
║  1. 创建虚拟串口对                       ║
║  2. 列出可用串口                         ║
║  3. 配置串口参数                         ║
║  4. 发送数据                             ║
║  5. 监听串口                             ║
║  6. 数据转发                             ║
║  7. 回环测试                             ║
║  8. 帮助                                 ║
║  0. 退出                                 ║
╚══════════════════════════════════════════╝

请选择操作 [0-8]:
```

---

## 7. Python API 使用

虚拟串口助手的所有功能都可以作为 Python 库被导入和使用。

### 7.1 完整的回环测试示例

```python
"""
回环测试：创建虚拟串口对，通过串口1发送数据，从串口2接收验证
"""
import time
from virtual_serial_assistant import VirtualSerialPair
from virtual_serial_assistant import SerialConfig, open_serial

def test_loopback():
    # 创建虚拟串口对
    with VirtualSerialPair() as (port1, port2):
        print(f"虚拟串口已创建: {port1} <-> {port2}")
        
        # 配置串口参数
        config = SerialConfig(baudrate=115200, bytesize=8, parity='N')
        
        # 打开两个串口
        ser1 = open_serial(port1, config)
        ser2 = open_serial(port2, config)
        
        try:
            # 发送测试数据
            test_data = b"Hello Virtual Serial!"
            ser1.write(test_data)
            print(f"Port1 发送: {test_data}")
            
            # 从 port2 读取
            time.sleep(0.1)  # 等待数据传输
            received = ser2.read(len(test_data))
            print(f"Port2 接收: {received}")
            
            # 验证
            assert received == test_data, "数据不一致！"
            print("✅ 回环测试通过！")
            
        finally:
            ser1.close()
            ser2.close()

if __name__ == "__main__":
    test_loopback()
```

### 7.2 多端口通信示例

```python
"""
模拟多个设备通过串口通信
"""
import threading
import time
from virtual_serial_assistant import VirtualSerialPair, open_serial, SerialConfig

def device_simulator(port, name, send_data, read_response=True):
    """模拟一个串口设备"""
    config = SerialConfig(baudrate=9600)
    ser = open_serial(port, config)
    
    try:
        ser.write(send_data)
        print(f"[{name}] 发送: {send_data}")
        
        if read_response:
            time.sleep(0.2)
            response = ser.read(100)
            print(f"[{name}] 收到: {response}")
    finally:
        ser.close()

# 创建两对虚拟串口（模拟两个设备连接到一个中间件）
with VirtualSerialPair() as (dev1_port, mid_port1):
    with VirtualSerialPair() as (dev2_port, mid_port2):
        
        # 启动设备模拟器线程
        t1 = threading.Thread(
            target=device_simulator,
            args=(dev1_port, "设备A", b"Temperature: 25.3C")
        )
        t2 = threading.Thread(
            target=device_simulator,
            args=(dev2_port, "设备B", b"Humidity: 68%")
        )
        
        # 中间件监听两个端口
        # ... (自定义中间件逻辑)
        
        t1.start()
        t2.start()
        t1.join()
        t2.join()
```

### 7.3 自定义数据处理器

```python
"""
使用回调函数处理接收到的数据
"""
from virtual_serial_assistant import VirtualSerialPair, SerialMonitor, SerialConfig

def create_data_processor(name):
    """创建一个数据处理器"""
    def process(data):
        print(f"[{name}] 收到 {len(data)} 字节: {data.hex()}")
        # 在这里添加自定义处理逻辑
        # 例如：解析协议、存储到数据库、发送到 MQTT 等
    return process

with VirtualSerialPair() as (port1, port2):
    config = SerialConfig(baudrate=115200)
    
    # 在两个端口上设置监听器
    monitor1 = SerialMonitor(port1, config)
    monitor2 = SerialMonitor(port2, config)
    
    monitor1.on_data(create_data_processor("Port1"))
    monitor2.on_data(create_data_processor("Port2"))
    
    monitor1.start()
    monitor2.start()
    
    # ... 数据收发 ...
    
    monitor1.stop()
    monitor2.stop()
```

---

## 8. 平台特定说明

### 8.1 Linux

Linux 上优先使用 Python 内置的 `pty` 模块，无需安装任何外部工具。虚拟串口通常创建在 `/dev/pts/` 目录下。

```bash
# 确认 pty 支持
python -c "import pty; print('PTY supported')"

# 安装 socat 作为备选（可选）
sudo apt install socat
```

**权限说明**：通常 `/dev/pts/` 下的设备对当前用户可读写。如果遇到权限问题，请确保用户在 `dialout` 组中：

```bash
sudo usermod -a -G dialout $USER
# 重新登录后生效
```

### 8.2 macOS

macOS 上同样优先使用 `pty` 模块。虚拟串口路径类似于 `/dev/ttysXXX` 或通过 socat 创建的符号链接。

```bash
# 安装 socat（可选）
brew install socat
```

### 8.3 Windows

Windows 需要额外的驱动或工具支持。推荐使用 **com0com**：

1. 从 [SourceForge](https://sourceforge.net/projects/com0com/) 下载并安装 com0com
2. 安装时勾选 "Add to PATH" 或将安装目录添加到系统 PATH
3. 安装完成后，`setupc.exe` 即可使用

或者使用 **socat for Windows**：

1. 从 [socat 官网](http://www.dest-unreach.org/socat/) 下载 Windows 版本
2. 将 `socat.exe` 放置到 PATH 中的某个目录

```cmd
# 验证 com0com 安装
setupc.exe list

# 验证 socat 安装
socat -V
```

---

## 9. 常见问题

### Q1: 创建虚拟串口失败

**Linux/macOS**：
```bash
# 检查 pty 是否可用
python -c "import pty; pty.openpty()"

# 如果失败，尝试使用 socat
python -m virtual_serial_assistant create --backend socat
```

**Windows**：
```bash
# 确认 com0com 已安装
where setupc.exe

# 以管理员身份运行
# 右键 PowerShell/CMD -> 以管理员身份运行
python -m virtual_serial_assistant create
```

### Q2: 串口被占用

```bash
# 查看占用进程
# Linux
lsof | grep /dev/pts

# 强制清理
python -m virtual_serial_assistant cleanup
```

### Q3: 数据收发乱码

检查波特率和编码设置是否匹配：

```bash
# 确保发送端和接收端参数一致
python -m virtual_serial_assistant config --port /dev/pts/5
python -m virtual_serial_assistant config --port /dev/pts/6
```

### Q4: 虚拟串口对中数据丢失

虚拟串口内部缓冲区有限，高速传输时可能出现数据丢失。建议：

- 降低传输速率
- 在应用层实现流控或确认机制
- 增加内部缓冲区大小（通过 `--buffer-size` 参数）

### Q5: 程序退出后虚拟串口仍然存在

```bash
# 手动清理
python -m virtual_serial_assistant cleanup --all

# 或使用上下文管理器（自动清理）
# with VirtualSerialPair() as (p1, p2):
#     ...
```

---

## 10. 实战示例

### 10.1 模拟 GPS 模块

```bash
# 终端 1：创建虚拟串口对并模拟 GPS NMEA 数据发送
python -m virtual_serial_assistant create --port1 /tmp/gps_out --port2 /tmp/gps_in

python -m virtual_serial_assistant send --port /tmp/gps_out \
    --data "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47" \
    --repeat 0 --interval 1.0
```

```bash
# 终端 2：监听 GPS 数据
python -m virtual_serial_assistant monitor --port /tmp/gps_in --baud 9600 --timestamp
```

### 10.2 串口调试——AT 命令测试

```bash
# 终端 1：创建虚拟串口并监听
python -m virtual_serial_assistant create
# 假设输出: /dev/pts/10 <-> /dev/pts/11
python -m virtual_serial_assistant monitor --port /dev/pts/11 --baud 115200
```

```bash
# 终端 2：发送 AT 命令
python -m virtual_serial_assistant send --port /dev/pts/10 --data "AT\r\n" --expect "OK"
python -m virtual_serial_assistant send --port /dev/pts/10 --data "AT+CSQ\r\n"
python -m virtual_serial_assistant send --port /dev/pts/10 --data "AT+CGATT?\r\n"
```

### 10.3 协议分析——转发并记录

```bash
# 在物理串口和虚拟串口之间转发，同时记录所有数据
python -m virtual_serial_assistant forward \
    --source COM3 \
    --target /tmp/virtual_debug \
    --baud 115200 \
    --log protocol_dump.log \
    --hex \
    --timestamp
```

### 10.4 自动化测试脚本

```python
#!/usr/bin/env python3
"""
使用虚拟串口进行嵌入式设备通信协议自动化测试
"""
import unittest
from virtual_serial_assistant import VirtualSerialPair, open_serial, SerialConfig

class TestSerialProtocol(unittest.TestCase):
    
    def setUp(self):
        """每个测试用例前创建新的虚拟串口对"""
        self.pair = VirtualSerialPair()
        self.port1, self.port2 = self.pair.__enter__()
        config = SerialConfig(baudrate=9600, timeout=1)
        self.ser1 = open_serial(self.port1, config)
        self.ser2 = open_serial(self.port2, config)
    
    def tearDown(self):
        """清理资源"""
        self.ser1.close()
        self.ser2.close()
        self.pair.__exit__(None, None, None)
    
    def test_ping_pong(self):
        """测试 Ping-Pong 协议"""
        self.ser1.write(b"PING\r\n")
        response = self.ser2.read(100)
        self.assertEqual(response, b"PING\r\n")
        
        # 模拟设备响应
        self.ser2.write(b"PONG\r\n")
        response = self.ser1.read(100)
        self.assertEqual(response, b"PONG\r\n")
    
    def test_binary_protocol(self):
        """测试二进制协议"""
        # 帧格式: [STX][LEN][DATA][CRC][ETX]
        frame = bytes([0x02, 0x05, 0x48, 0x45, 0x4C, 0x4C, 0x4F, 0xA5, 0x03])
        self.ser1.write(frame)
        received = self.ser2.read(len(frame))
        self.assertEqual(received, frame)

if __name__ == "__main__":
    unittest.main()
```

### 10.5 配合其他工具使用

```bash
# 使用 minicom 连接虚拟串口
python -m virtual_serial_assistant create --port1 /tmp/vcom_a --port2 /tmp/vcom_b
minicom -D /tmp/vcom_a -b 115200

# 使用 screen 连接
screen /tmp/vcom_a 115200

# 使用 PuTTY (Windows) 连接虚拟 COM 口
# 在 PuTTY 中选择 "Serial"，填入 COM5（或其他分配的 COM 号），设置波特率

# 使用 Python 的 pyserial 库直接操作
python -c "
import serial
ser = serial.Serial('/tmp/vcom_a', 115200)
ser.write(b'Hello!')
print(ser.read(100))
ser.close()
"
```

---

## 附录：命令行完整参考

### `create` 子命令

```
用法: python -m virtual_serial_assistant create [选项]

选项:
  --port1 TEXT      第一个端口名称/路径
  --port2 TEXT      第二个端口名称/路径
  --backend TEXT    后端选择: auto, pty, socat, com0com
  --no-cleanup      程序退出后保留虚拟串口
```

### `send` 子命令

```
用法: python -m virtual_serial_assistant send [选项]

选项:
  --port TEXT       目标串口 (必需)
  --baud NUMBER     波特率 (默认: 9600)
  --data TEXT       要发送的文本数据
  --hex TEXT        要发送的十六进制数据 (空格分隔)
  --file TEXT       从文件读取数据发送
  --repeat NUMBER   重复发送次数 (0=无限循环)
  --interval FLOAT  重复发送间隔(秒)
  --expect TEXT     等待接收的响应内容
  --timeout FLOAT   等待响应的超时时间(秒)
```

### `monitor` 子命令

```
用法: python -m virtual_serial_assistant monitor [选项]

选项:
  --port TEXT       要监听的串口 (必需)
  --baud NUMBER     波特率 (默认: 9600)
  --format TEXT     显示格式: text, hex, both (默认: text)
  --timestamp       显示时间戳
  --log FILE        记录到文件
  --filter TEXT     仅显示包含此文本的行
```

### `forward` 子命令

```
用法: python -m virtual_serial_assistant forward [选项]

选项:
  --source TEXT     源串口 (必需)
  --target TEXT     目标串口 (必需)
  --source-baud N   源串口波特率 (默认: 9600)
  --target-baud N   目标串口波特率 (默认: 9600)
  --direction TEXT  转发方向: bidirectional, source-to-target, target-to-source
  --timestamp       添加时间戳
  --log FILE        记录转发的数据
  --hex             十六进制显示
  --filter TEXT     数据过滤
  --replace TEXT    数据替换 (格式: old:new)
```

---

> 💡 **提示**：所有命令均可附加 `--verbose` 选项来查看详细执行日志，便于调试。
