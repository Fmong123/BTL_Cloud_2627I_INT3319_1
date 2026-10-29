"""Opt-in real Vite/FastAPI launch, upload, mode change and process cleanup."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import ROOT, RUNTIME, Settings
from environment import Environment
from project import Project
from test_launcher import free_port, reachable


@unittest.skipUnless(os.environ.get("MAYSEC_LAUNCHER_SMOKE") == "1", "Set MAYSEC_LAUNCHER_SMOKE=1 for real local servers")
class LocalSmoke(unittest.TestCase):
    def test_real_local_and_demo(self):
        RUNTIME.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="smoke-", dir=RUNTIME) as directory:
            runtime = Path(directory)
            settings = Settings(ROOT, runtime)
            web_port, api_port = free_port(), free_port()
            while api_port == web_port:
                api_port = free_port()
            settings.data.update(web_port=web_port, api_port=api_port, max_file_mb="1",
                                 overrides={"MAYSEC_LOCAL_STORAGE_DIR": str(runtime / "data")})
            env = Environment(ROOT, runtime)
            project = Project(settings, env)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                project.start(settings.resolve(parent={}))
                with opener.open(f"http://127.0.0.1:{api_port}/health") as response:
                    health = json.load(response)
                self.assertEqual(health["storage"], "local")
                self.assertEqual(health["metadata_mode"], "disabled")
                with opener.open(f"http://127.0.0.1:{web_port}/") as response:
                    self.assertIn("/@vite/client", response.read().decode())
                boundary = "maysec-launcher-offline-check"
                content = b"launcher-local-smoke"
                body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.txt"\r\nContent-Type: text/plain\r\n\r\n'.encode()
                        + content + f"\r\n--{boundary}--\r\n".encode())
                request = urllib.request.Request(f"http://127.0.0.1:{api_port}/upload", data=body,
                    headers={"Content-Type": "multipart/form-data; boundary=" + boundary, "Origin": f"http://127.0.0.1:{web_port}"})
                with opener.open(request) as response:
                    self.assertEqual(response.status, 201)
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], f"http://127.0.0.1:{web_port}")
                    uploaded = json.load(response)
                self.assertEqual((runtime / "data" / uploaded["key"]).read_bytes(), content)
                project.stop()
                self.assertFalse(reachable(api_port))
                self.assertFalse(reachable(web_port))
                settings.data["mode"] = "demo"
                project.start(settings.resolve(parent={}))
                self.assertEqual(set(project.services), {"WEB"})
                self.assertFalse(reachable(api_port))
            finally:
                project.stop()
            self.assertFalse(reachable(web_port))


if __name__ == "__main__":
    unittest.main()
