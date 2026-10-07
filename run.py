import http.server
import socketserver
import threading
import ui
from pathlib import Path

PORT = 8765
ROOT = Path(__file__).parent


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
    webview.load_url(f"http://127.0.0.1:{PORT}/")
    webview.present("fullscreen", hide_title_bar=True)
