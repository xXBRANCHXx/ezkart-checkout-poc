#!/usr/bin/env python3
"""Keep a local concept preview available across Codex turns (stdlib only)."""

import argparse
import functools
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ENDPOINT = "/__ezkart_preview__"


def state_path(root):
    return root.parent / f".{root.name}.preview.json"


def request(state, method="GET"):
    req = Request(
        f"http://127.0.0.1:{int(state['port'])}{ENDPOINT}",
        headers={"Authorization": f"Bearer {state['token']}"},
        method=method,
    )
    with urlopen(req, timeout=1) as response:
        return json.load(response)


def running(root):
    try:
        state = json.loads(state_path(root).read_text())
        return state if request(state).get("root") == str(root) else None
    except (OSError, URLError, ValueError, KeyError):
        return None


def serve(root, port):
    token = secrets.token_urlsafe(24)

    class Handler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def send_head(self):
            # Serve assets inside site/, including their relative URLs.
            path = Path(self.translate_path(self.path)).resolve()
            if not path.is_relative_to(root):
                self.send_error(404)
                return None
            return super().send_head()

        def list_directory(self, path):
            self.send_error(404)
            return None

        def control(self):
            if self.headers.get("Authorization") != f"Bearer {token}":
                self.send_error(403)
                return False
            body = json.dumps({"root": str(root)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True

        def do_GET(self):
            if urlsplit(self.path).path == ENDPOINT:
                self.control()
            else:
                super().do_GET()

        def do_POST(self):
            if urlsplit(self.path).path != ENDPOINT:
                self.send_error(404)
            elif self.control():
                threading.Thread(target=server.shutdown, daemon=True).start()

    server = ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Handler, directory=str(root))
    )
    state = {
        "root": str(root),
        "port": server.server_port,
        "url": f"http://127.0.0.1:{server.server_port}/",
        "token": token,
    }
    path = state_path(root)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(state))
    temporary.chmod(0o600)
    temporary.replace(path)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()
        if path.exists() and json.loads(path.read_text()).get("token") == token:
            path.unlink()


def start(root, port):
    state = running(root)
    if state:
        return state
    if not (root / "index.html").is_file():
        raise ValueError(f"Create {root / 'index.html'} before starting the preview.")
    log_path = root.parent / f".{root.name}.preview.log"
    with log_path.open("a") as log:
        child = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "serve", str(root), "--port", str(port)],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    for _ in range(50):
        state = running(root)
        if state:
            return state
        if child.poll() is not None:
            break
        time.sleep(0.1)
    child.terminate()
    child.wait(timeout=3)
    raise RuntimeError(f"Preview did not start. Read {log_path}.")


def open_browser(url, root):
    opener = shutil.which("xdg-open")
    if not opener:
        return "unavailable: open the URL manually"
    with (root.parent / f".{root.name}.browser.log").open("a") as log:
        child = subprocess.Popen(
            [opener, url], stdin=subprocess.DEVNULL,
            stdout=log, stderr=log, start_new_session=True,
        )
    try:
        code = child.wait(timeout=5)
        return "opened" if code == 0 else f"failed (exit {code}): open the URL manually"
    except subprocess.TimeoutExpired:
        return "launch requested"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["start", "status", "stop", "serve"])
    parser.add_argument("site", type=Path, help="Website directory containing index.html")
    parser.add_argument("--port", type=int, default=0, help="0 chooses an available port")
    parser.add_argument("--open", action="store_true", help="Open the default browser")
    args = parser.parse_args()
    root = args.site.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"Website directory does not exist: {root}")
    if args.command == "serve":
        serve(root, args.port)
        return
    state = start(root, args.port) if args.command == "start" else running(root)
    result = {"running": bool(state), "site": str(root)}
    if state:
        if args.command == "stop":
            request(state, "POST")
            for _ in range(30):
                if not running(root):
                    break
                time.sleep(0.1)
            result["running"] = bool(running(root))
            if result["running"]:
                raise RuntimeError("Preview is still stopping; check status before restarting.")
        else:
            result["url"] = state["url"]
            if args.open:
                result["browser"] = open_browser(state["url"], root)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
