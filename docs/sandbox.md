# Docker 沙箱（隔离 shell 执行）

默认关闭。开启后，Agent 的 `run_terminal_command` 在一次性 Docker 容器内执行，
而不是直接在宿主上跑——命令无法访问宿主进程、无法触碰项目目录以外的宿主文件，
资源受限，容器用完即焚。项目目录通过 bind mount 共享，所以 Agent 写的代码会持久化。

## 开启

在 `~/.workflow_config.json` 加入：

```json
{
  "sandboxConfig": {
    "enabled": true,
    "image": "node:22",
    "network": "bridge",
    "memory": "2g",
    "cpus": "2"
  }
}
```

- **image**：选一个含项目所需工具链的镜像（`node:22`、`python:3.12`、`ubuntu:24.04` …）。
  容器里只有该镜像自带的工具，缺什么命令就换含该工具的镜像或在命令里自行安装。
- **network**：`bridge`（默认，允许联网，装依赖用）｜ `none`（断网，最强隔离）。
- **memory / cpus**：资源上限。

## 前提

- 宿主装好 Docker 并可用（`docker version` 能跑通）。
- 沙箱开启但 Docker 不可用时，命令会**直接报错**而非悄悄回退到宿主执行
  （否则隔离形同虚设）。
- 主要面向 Linux / WSL2 部署；Windows Docker Desktop 的盘符路径由其自行转换。

## 执行模式

- **持久容器（v2，默认）**：在一次 `autocode run`/`chat` 工作流内，开启沙箱会起**一个**常驻容器
  （`docker run -d ... sleep infinity`），所有命令经 `docker exec` 跑进同一个容器，工作流结束销毁。
  `cd`、环境变量、安装的依赖在命令之间**保留**，贴近真实 shell。
- **单命令容器（v1，兜底）**：工作流之外执行命令时（无活跃会话），退回每条命令一个 `--rm` 容器——
  无状态，但文件改动经挂载持久化。

## 边界

- 沙箱只隔离 `run_terminal_command`。文件读写工具仍在宿主执行，受路径越界防护约束，
  操作的是同一个被挂载进容器的项目目录，行为一致。
- 命令黑名单（`assertCommandAllowed`）在沙箱模式下仍然生效（纵深防御）。
- 开启沙箱但 Docker 不可用时，工作流起容器即报错（安全失败，不回退宿主）。
