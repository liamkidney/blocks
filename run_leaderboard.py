"""Standalone Pythonista harness for the Supabase leaderboard test page.

Run from the Blocks repository directory. No game files are modified.
"""
import http.server
import socketserver
import threading
from pathlib import Path

import ui

PORT = 8766
ROOT = Path(__file__).resolve().parent
PAGE = "leaderboard-test.html"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


def main():
    if not (ROOT / PAGE).is_file():
        raise FileNotFoundError(f"Missing {PAGE} in {ROOT}")
    server = Server(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        webview = ui.WebView()
        webview.load_url(f"http://127.0.0.1:{PORT}/{PAGE}")
        webview.present("fullscreen", hide_title_bar=True)
        webview.wait_modal()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
