from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
import time

import uvicorn

from agentos.api.app import create_app
from agentos.config import AgentOSSettings


def _start_parent_watchdog(server: uvicorn.Server) -> None:
    """Exit cleanly if the desktop parent process exits or crashes unexpectedly."""
    raw_ppid = os.environ.get("AGENTOS_PARENT_PID", "").strip()
    if not raw_ppid:
        return
    try:
        parent_pid = int(raw_ppid)
    except ValueError:
        return
    if parent_pid <= 1:
        return

    def _watch() -> None:
        while not server.should_exit:
            time.sleep(0.5)
            if os.name != "nt" and os.getppid() != parent_pid:
                server.should_exit = True
                return
            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                server.should_exit = True
                return
            except PermissionError:
                continue

    thread = threading.Thread(target=_watch, name="agentos-parent-watchdog", daemon=True)
    thread.start()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the local AgentOS backend server.")
    parser.add_argument("--host", default=None, help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=None, help="Bind port (default: 47821)")
    args = parser.parse_args()

    overrides: dict[str, object] = {}
    if args.host:
        overrides["host"] = args.host
    if args.port:
        overrides["port"] = args.port

    settings = AgentOSSettings(**overrides)  # type: ignore[arg-type]
    settings.ensure_loopback_policy()
    app = create_app(settings=settings)

    config = uvicorn.Config(
        app=app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        access_log=False,
    )
    server = uvicorn.Server(config)

    def _handle_signal(_signum: int, _frame: object) -> None:
        server.should_exit = True

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    _start_parent_watchdog(server)

    server.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
