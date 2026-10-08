import http.server
import socketserver
import threading
import ui
from pathlib import Path

PORT = 8766
ROOT = Path(__file__).parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/config.js":
            body = b'window.BLOCKS_CONFIG = {allowedPieces:["I","O"]};\n'
            content_type = "application/javascript"
        elif path == "/":
            body = (ROOT / "index.html").read_bytes()
            content_type = "text/html; charset=utf-8"
        else:
            return super().do_GET()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    server = Server(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    webview = ui.WebView()
    webview.load_url(f"http://127.0.0.1:{PORT}/")
    webview.present("fullscreen", hide_title_bar=True)
