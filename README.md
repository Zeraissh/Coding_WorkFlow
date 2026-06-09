# 虚拟串口助手 (Virtual Serial Port Assistant)

一个用 Python 开发的跨平台虚拟串口助手，支持创建虚拟串口对、配置串口参数、数据收发和转发等功能。

## ✨ 功能特性

- **虚拟串口对创建**：在 Linux / macOS / Windows 上创建成对的虚拟串口，模拟物理零调制解调器（null-modem）线缆
- **串口参数配置**：支持配置波特率、数据位、停止位、校验位、流控等常见串口参数
- **数据收发**：通过命令行或图形界面进行串口数据的发送与接收，支持十六进制和文本模式
- **数据转发**：在两个串口之间实时双向转发数据，适用于调试、协议分析等场景
- **跨平台支持**：
  - **Linux / macOS**：基于内置 `pty` 模块，无需额外依赖；亦可使用 `socat` 作为备选
  - **Windows**：支持 com0com 驱动和 socat 两种方案
- **友好的命令行界面**：提供交互式菜单和命令行参数两种操作方式
- **可选的图形界面**：基于 Tkinter 的简易 GUI，方便可视化操作

## 📋 环境要求

- **Python**：3.8 及以上版本
- **操作系统**：
  - Linux（推荐 Ubuntu 20.04+ / Debian 11+）
  - macOS（10.15 Catalina 及以上）
  - Windows（10/11，需要安装 com0com 或 socat）

### 外部工具（可选，按需安装）

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| **socat** | 备用虚拟串口创建方案 | Linux: `apt install socat` / macOS: `brew install socat` |
| **com0com** | Windows 虚拟串口驱动（推荐） | [SourceForge 下载](https://sourceforge.net/projects/com0com/) |

> **说明**：在 Linux 和 macOS 上，本工具优先使用 Python 内置的 `pty` 模块，**无需安装任何外部依赖**即可创建虚拟串口对。`socat` 仅作为备选方案。

## 📦 安装

### 方式一：从源码安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/virtual-serial-assistant.git
cd virtual-serial-assistant

# 安装依赖
pip install -r requirements.txt

# 直接运行
python -m virtual_serial_assistant
```

### 方式二：使用 pip 安装（如果已发布到 PyPI）

```bash
pip install virtual-serial-assistant
```

### 依赖说明

核心 Python 依赖（见 `requirements.txt`）：

```
pyserial>=3.5          # 串口通信基础库
```

可选依赖：

```
# GUI 支持（Tkinter 通常随 Python 一起安装，无需额外操作）
# 如使用 PyQt 版本，需额外安装：
# PyQt5>=5.15
```

## 🚀 快速开始

### 1. 创建虚拟串口对

```bash
# 交互模式
python -m virtual_serial_assistant create

# 命令行模式
python -m virtual_serial_assistant create --port1 /tmp/vport1 --port2 /tmp/vport2
```

执行后将输出创建的虚拟串口名称，例如：

```
✅ 虚拟串口对创建成功: /dev/pts/5 <-> /dev/pts/6
```

### 2. 配置串口参数并发送数据

```bash
# 打开串口，配置参数，发送数据
python -m virtual_serial_assistant send --port /dev/pts/5 --baud 9600 --data "Hello Serial!"
```

### 3. 监听串口数据

```bash
# 在另一个终端监听另一个串口
python -m virtual_serial_assistant monitor --port /dev/pts/6 --baud 9600
```

### 4. 数据转发

```bash
# 在两个物理/虚拟串口之间转发数据
python -m virtual_serial_assistant forward --source COM1 --target COM2 --baud 115200
```

## 📂 项目结构

```
virtual-serial-assistant/
├── README.md                          # 项目介绍（本文件）
├── USAGE.md                           # 详细使用说明
├── requirements.txt                   # Python 依赖
├── virtual_serial_assistant/
│   ├── __init__.py                    # 包初始化
│   ├── __main__.py                    # 入口：python -m virtual_serial_assistant
│   ├── virtual_serial.py              # 核心：虚拟串口对创建
│   ├── serial_config.py               # 串口参数配置
│   ├── serial_monitor.py              # 数据收发与监听
│   ├── serial_forwarder.py            # 数据转发引擎
│   ├── cli.py                         # 命令行交互界面
│   └── gui.py                         # 图形界面（可选）
└── tests/
    ├── test_virtual_serial.py
    ├── test_serial_config.py
    ├── test_serial_monitor.py
    └── test_serial_forwarder.py
```

## 🔧 支持的串口参数

| 参数 | 可选值 | 默认值 |
|------|--------|--------|
| 波特率 (baud rate) | 300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600 | 9600 |
| 数据位 (data bits) | 5, 6, 7, 8 | 8 |
| 停止位 (stop bits) | 1, 1.5, 2 | 1 |
| 校验位 (parity) | N (无), E (偶), O (奇), M (标记), S (空格) | N |
| 流控 (flow control) | none, hardware (RTS/CTS), software (XON/XOFF) | none |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请确保代码通过现有测试并遵循项目代码风格。

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [pyserial](https://github.com/pyserial/pyserial) - Python 串口通信库
- [com0com](https://sourceforge.net/projects/com0com/) - Windows 虚拟串口驱动
- [socat](http://www.dest-unreach.org/socat/) - 多功能网络工具
