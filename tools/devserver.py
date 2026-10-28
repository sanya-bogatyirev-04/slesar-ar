"""Локальный сервер для разработки: раздаёт папку ar/ и принимает PUT /save/<файл в assets>
(нужен, чтобы сохранить скомпилированную в браузере метку MindAR)."""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {"marker.mind"}


class Handler(SimpleHTTPRequestHandler):
    def do_PUT(self):
        name = self.path.removeprefix("/save/")
        if name not in ALLOWED:
            self.send_error(403)
            return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        (ROOT / "assets" / name).write_bytes(data)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f"saved {len(data)} bytes".encode())

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT))).serve_forever()
