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


class Handler(http.server.SimpleHTTPRequestHandler):
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
    if PLAYERS == 2:
        params["players"] = "2"
    webview.load_url(f"http://127.0.0.1:{PORT}/?{urlencode(params)}")
    webview.present("fullscreen", hide_title_bar=True)
