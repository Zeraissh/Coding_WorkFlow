#!/usr/bin/env python3
"""官方评测包装器：IPv4 优先 + HF 镜像探测 + 全局 HTTP 重试（扛网络抖动）。"""
import os, socket, sys, urllib.request, runpy

_orig = socket.getaddrinfo
def _v4first(*a, **k):
    r = _orig(*a, **k)
    v4 = [x for x in r if x[0] == socket.AF_INET]
    return v4 or r
socket.getaddrinfo = _v4first

# requests 全局重试：harness 裸用 requests.get 拉 raw.githubusercontent.com，
# 断网瞬间一次 SSL EOF 就会带崩整个评测
import requests.adapters
from urllib3.util.retry import Retry
_orig_init = requests.adapters.HTTPAdapter.__init__
def _patched_init(self, *a, **k):
    k.setdefault("max_retries", Retry(total=6, backoff_factor=3, status_forcelist=[429, 500, 502, 503, 504]))
    _orig_init(self, *a, **k)
requests.adapters.HTTPAdapter.__init__ = _patched_init

if not os.environ.get("HF_ENDPOINT"):
    try:
        urllib.request.urlopen("https://huggingface.co/api/datasets?limit=1", timeout=5)
    except Exception:
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
        print("huggingface.co unreachable - using mirror", flush=True)

sys.argv = ["run_evaluation",
    "--dataset_name", "princeton-nlp/SWE-bench_Lite",
    "--predictions_path", "predictions.jsonl",
    "--max_workers", "4",
    "--run_id", "coding-workflow-v1"]
runpy.run_module("swebench.harness.run_evaluation", run_name="__main__")
