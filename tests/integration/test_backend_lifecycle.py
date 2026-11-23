from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def test_real_backend_process_start_auth_and_graceful_stop(tmp_path: Path) -> None:
    """Spawns the real backend subprocess, checks health + auth, and verifies clean SIGTERM exit."""
    port = _free_port()
    token = "integration-lifecycle-token-0123456789abcdef"
    env = os.environ.copy()
    env["AGENTOS_SESSION_TOKEN"] = token
    env["AGENTOS_DATA_DIR"] = str(tmp_path / "runtime_data")
    env["PYTHONUNBUFFERED"] = "1"

    backend_dir = Path(__file__).resolve().parents[2] / "backend"
    proc = subprocess.Popen(
        [sys.executable, "-m", "agentos", "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(backend_dir),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    base_url = f"http://127.0.0.1:{port}"
    try:
        ready = False
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                out, err = proc.communicate(timeout=2)
                raise AssertionError(f"Backend exited early ({proc.returncode}): {out}\n{err}")
            try:
                resp = httpx.get(f"{base_url}/api/v1/health", timeout=1.0)
                if resp.status_code == 200 and resp.json().get("status") == "ok":
                    ready = True
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.15)

        if not ready:
            proc.terminate()
            out, err = proc.communicate(timeout=5)
            raise AssertionError(f"Backend failed to become ready within 15s.\nSTDOUT:\n{out}\nSTDERR:\n{err}")

        unauth = httpx.get(f"{base_url}/api/v1/system/bootstrap", timeout=2.0)
        assert unauth.status_code == 401

        auth = httpx.get(
            f"{base_url}/api/v1/system/bootstrap",
            headers={"Authorization": f"Bearer {token}"},
            timeout=2.0,
        )
        assert auth.status_code == 200
        assert auth.json()["app"]["name"] == "AgentOS"

        proc.send_signal(signal.SIGTERM)
        exit_code = proc.wait(timeout=8.0)
        assert exit_code == 0
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
