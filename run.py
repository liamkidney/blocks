import hashlib
import http.server
import socketserver
import threading
import ui
from pathlib import Path
from urllib.parse import urlencode

PORT = 8765
ROOT = Path(__file__).parent

# Change these to test different modes in Pythonista.
GHOST = True
PLAYERS = 1
PIECES = "ALL"  # Set to "IO" for I/O pieces only


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


def start_server():
    server = Server(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    server = start_server()
    webview = ui.WebView()
    params = {"ghost": "true" if GHOST else "false"}
    if PIECES.upper() == "IO":
        params["pieces"] = "IO"
    if PLAYERS == 2:
        params["players"] = "2"
    # Change the URL only when the local HTML changes; retain cached assets and offline play.
    html_path = ROOT / "index.html"
    html = html_path.read_bytes()
    params["v"] = hashlib.sha256(html).hexdigest()[:12]
    title_marker = b'id="landscape-title"'
    title_position = html.find(title_marker)
    print(f"Serving HTML: {html_path.resolve()}")
    print(f"Local title snippet: {html[title_position:title_position + 90].decode('utf-8', errors='replace') if title_position >= 0 else 'NOT FOUND'}")
    print(f"HTML version: {params['v']}")
    webview.load_url(f"http://127.0.0.1:{PORT}/?{urlencode(params)}")
    webview.present("fullscreen", hide_title_bar=True)
