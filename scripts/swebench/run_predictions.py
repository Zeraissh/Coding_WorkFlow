#!/usr/bin/env python3
"""
SWE-bench-Lite 补丁生成适配器（在 WSL2 / Linux 中运行）。

对数据集中的每道题：
  1. clone 对应仓库（带缓存）并强制 checkout 到 base_commit、清理工作区
  2. 把 issue 描述喂给 `autocode run`（带单题超时）
  3. 收集相对 base_commit 的 git diff 作为 model_patch
  4. 追加写入 predictions.jsonl（官方评测 harness 的输入格式）

特性：断点续跑（已有结果的题自动跳过）、单题超时强杀、.workflow 运行
产物自动排除出补丁、失败题记录空补丁不中断整批。

用法示例：
  python3 run_predictions.py --limit 5                  # 先跑 5 题冒烟
  python3 run_predictions.py --instances django__django-11099
  python3 run_predictions.py                            # 全量 300 题

之后用官方 harness 评测：
  python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path predictions.jsonl \
    --max_workers 4 --run_id coding-workflow-v1
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


# IPv4 优先：部分网络环境 IPv6 路由黑洞，而 httpx（huggingface_hub 的传输层）
# 不做地址回退，解析到 IPv6 就会 SSL EOF 吊死。标准库会逐地址重试所以没事。
# 这里统一过滤出 IPv4 结果（无 IPv4 时保留原结果，不破坏纯 v6 环境）。
_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_first_getaddrinfo(*args, **kwargs):
    results = _orig_getaddrinfo(*args, **kwargs)
    ipv4 = [r for r in results if r[0] == socket.AF_INET]
    return ipv4 or results


socket.getaddrinfo = _ipv4_first_getaddrinfo


# 受限网络自适应：huggingface_hub 在 import 时固化 HF_ENDPOINT，
# 所以必须在导入 datasets 之前探测并设置镜像。
def _ensure_hf_endpoint():
    if os.environ.get("HF_ENDPOINT"):
        return
    try:
        urllib.request.urlopen("https://huggingface.co/api/datasets?limit=1", timeout=5)
    except Exception:
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
        print("huggingface.co unreachable — using mirror https://hf-mirror.com", flush=True)


_ensure_hf_endpoint()

try:
    from datasets import load_dataset
except ImportError:
    sys.exit("Missing dependency: pip install datasets")


def sh(cmd, cwd=None, timeout=None, check=True, capture=True):
    """Run a command; returns (exitcode, stdout)."""
    result = subprocess.run(
        cmd,
        cwd=cwd,
        timeout=timeout,
        capture_output=capture,
        text=True,
        errors="replace",
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(cmd)}\n{(result.stderr or '')[:500]}"
        )
    return result.returncode, (result.stdout or "")


def load_done_ids(output_path: Path) -> set:
    done = set()
    if output_path.exists():
        for line in output_path.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["instance_id"])
            except (json.JSONDecodeError, KeyError):
                continue
    return done


def prepare_repo(repos_dir: Path, repo: str, base_commit: str) -> Path:
    """Clone（缓存）+ 强制重置到 base_commit + 清理一切残留。"""
    repo_dir = repos_dir / repo.replace("/", "__")
    if not repo_dir.exists():
        print(f"  cloning {repo} ...", flush=True)
        sh(["git", "clone", f"https://github.com/{repo}.git", str(repo_dir)], timeout=1800)

    # 离开可能残留的 autocode 分支 → 重置 → 清理未跟踪文件（含上一题的 .workflow）
    sh(["git", "checkout", "-f", base_commit], cwd=repo_dir, timeout=300)
    sh(["git", "clean", "-fdx"], cwd=repo_dir, timeout=300)

    # 运行产物不进补丁
    exclude_file = repo_dir / ".git" / "info" / "exclude"
    exclude_file.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude_file.read_text() if exclude_file.exists() else ""
    if ".workflow/" not in existing:
        exclude_file.write_text(existing + "\n.workflow/\n")
    return repo_dir


def collect_patch(repo_dir: Path, base_commit: str) -> str:
    """暂存全部改动后取相对 base_commit 的 diff（无论 agent 是否自行 commit 都能捕获）。"""
    sh(["git", "add", "-A"], cwd=repo_dir, timeout=300, check=False)
    _, patch = sh(
        ["git", "diff", "--cached", base_commit, "--", ".", ":(exclude).workflow"],
        cwd=repo_dir,
        timeout=300,
        check=False,
    )
    return patch


def run_agent(repo_dir: Path, problem: str, timeout_s: int, autocode_cmd: str) -> bool:
    """跑一次 autocode run；超时/失败返回 False（但仍会尝试收集已产出的改动）。"""
    goal = (
        "Fix the following GitHub issue in this repository. "
        "Modify the source code; do not just describe the fix.\n\n" + problem
    )
    try:
        code, _ = sh([autocode_cmd, "run", goal], cwd=repo_dir, timeout=timeout_s, check=False, capture=False)
        return code == 0
    except subprocess.TimeoutExpired:
        print("  ⏱ timed out — collecting whatever was produced", flush=True)
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", default="predictions.jsonl")
    parser.add_argument("--workdir", default="swebench_work", help="repo 缓存目录")
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 题（0 = 全部）")
    parser.add_argument("--instances", default="", help="只跑指定题，逗号分隔的 instance_id")
    parser.add_argument("--timeout", type=int, default=1800, help="单题超时秒数（默认 30 分钟）")
    parser.add_argument("--model-name", default="coding-workflow")
    parser.add_argument("--autocode-cmd", default="autocode", help="autocode 可执行命令")
    args = parser.parse_args()

    output_path = Path(args.output)
    repos_dir = Path(args.workdir) / "repos"
    repos_dir.mkdir(parents=True, exist_ok=True)

    print("Loading SWE-bench_Lite dataset ...", flush=True)
    ds = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")

    wanted = {s.strip() for s in args.instances.split(",") if s.strip()}
    done = load_done_ids(output_path)
    print(f"{len(done)} instance(s) already done — will skip them.", flush=True)

    processed = 0
    for inst in ds:
        iid = inst["instance_id"]
        if wanted and iid not in wanted:
            continue
        if iid in done:
            continue
        if args.limit and processed >= args.limit:
            break
        processed += 1

        print(f"\n[{processed}] {iid} ({inst['repo']} @ {inst['base_commit'][:10]})", flush=True)
        start = time.time()
        patch = ""
        try:
            repo_dir = prepare_repo(repos_dir, inst["repo"], inst["base_commit"])
            run_agent(repo_dir, inst["problem_statement"], args.timeout, args.autocode_cmd)
            patch = collect_patch(repo_dir, inst["base_commit"])
        except Exception as e:  # 单题失败不中断整批
            print(f"  ✗ error: {e}", flush=True)

        record = {
            "instance_id": iid,
            "model_name_or_path": args.model_name,
            "model_patch": patch,
        }
        with output_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

        status = "patch captured" if patch.strip() else "EMPTY patch"
        print(f"  → {status} ({len(patch)} chars, {time.time() - start:.0f}s)", flush=True)

    total = len(load_done_ids(output_path))
    print(f"\nDone. {total} prediction(s) in {output_path}.", flush=True)
    print("Next: python -m swebench.harness.run_evaluation "
          f"--dataset_name princeton-nlp/SWE-bench_Lite --predictions_path {output_path} "
          "--max_workers 4 --run_id coding-workflow-v1", flush=True)


if __name__ == "__main__":
    main()
