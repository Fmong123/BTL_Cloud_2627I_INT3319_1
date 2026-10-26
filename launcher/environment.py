"""Inspect and install only project dependencies; the launcher uses the stdlib."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

from config import ROOT, RUNTIME, atomic_write, clean_aws_env


def redact(text: str) -> str:
    text = re.sub(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b", "[ACCESS_KEY_ĐÃ_ẨN]", text)
    text = re.sub(r"(?i)((?:aws_)?(?:secret_access_key|session_token|access_token|refresh_token|password)\s*[=:]\s*)[^\s,]+", r"\1[ĐÃ_ẨN]", text)
    return re.sub(r"(https?://)[^/\s:@]+:[^/\s@]+@", r"\1[ĐÃ_ẨN]@", text)


def capture(args, *, cwd=None, env=None, timeout=20):
    try:
        result = subprocess.run([str(a) for a in args], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                encoding="utf-8", errors="replace", timeout=timeout,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        return result.returncode, redact(result.stdout.strip())
    except subprocess.TimeoutExpired:
        return 124, "Quá thời gian chờ. Kiểm tra mạng hoặc tiến trình bị treo."
    except OSError:
        return 127, "Không chạy được chương trình; kiểm tra cài đặt và PATH."


class Environment:
    def __init__(self, root=ROOT, runtime=RUNTIME):
        self.root, self.runtime = Path(root), Path(runtime)
        self.python = self.root / ("backend/.venv/Scripts/python.exe" if os.name == "nt" else "backend/.venv/bin/python")
        self.node = shutil.which("node")
        self.pnpm = shutil.which("pnpm.cmd" if os.name == "nt" else "pnpm")
        self.aws = shutil.which("aws")

    def backend_python(self, script, *, args=(), env=None, timeout=25):
        env = clean_aws_env() if env is None else dict(env)
        env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        return capture([self.python, "-c", script, *args], cwd=self.root / "backend",
                       env=env, timeout=timeout)

    def inspect(self, thorough=True):
        checks = [("Python cho launcher", sys.version_info >= (3, 10), sys.version.split()[0])]
        node_ok, node_text = False, "Chưa có Node.js (khuyến nghị 22+)."
        if self.node:
            code, node_text = capture([self.node, "--version"])
            match = re.match(r"v(\d+)", node_text)
            node_ok = code == 0 and bool(match) and int(match[1]) >= 22
        checks.append(("Node.js 22+", node_ok, node_text))
        if self.pnpm:
            code, message = capture([self.pnpm, "--version"])
            checks.append(("pnpm", code == 0, message))
        else:
            checks.append(("pnpm", False, "Cần pnpm để dùng pnpm-lock.yaml của project."))
        checks.append(("Backend .venv", self.python.is_file(), str(self.python.relative_to(self.root))))
        if self.python.is_file():
            code, message = self.backend_python("import fastapi, uvicorn, multipart, boto3, dotenv; print('Import thư viện chạy: OK')")
            checks.append(("Thư viện backend", code == 0, message.splitlines()[-1] if message else "Không có kết quả"))
            if thorough:
                code, message = capture([self.python, "-m", "pip", "check"], cwd=self.root / "backend", timeout=30)
                checks.append(("Tương thích dependency backend", code == 0, message))
        vite = self.root / "frontend/node_modules/vite/bin/vite.js"
        if self.node and vite.is_file():
            script = "Promise.all(['vite','react','react-dom','lucide-react','@vitejs/plugin-react'].map(x=>import(x))).then(()=>console.log('Import dependency frontend: OK')).catch(()=>{console.log('Dependency frontend thiếu hoặc không tương thích; hãy cài lại.');process.exit(1)})"
            code, message = capture([self.node, "--input-type=module", "-e", script], cwd=self.root / "frontend")
            checks.append(("Dependency frontend", code == 0, message))
        else:
            checks.append(("Dependency frontend", False, "Chưa có Vite hoặc Node.js."))
        if self.aws:
            code, message = capture([self.aws, "--version"])
            checks.append(("AWS CLI (chỉ cần cho AWS)", code == 0, message))
        else:
            checks.append(("AWS CLI (chỉ cần cho AWS)", False, "Chưa cài AWS CLI."))
        changed = self.changed_dependencies()
        checks.append(("Requirements / lockfile", not changed, "Đã đổi từ lần cài gần nhất: " + ", ".join(changed) if changed else "Không đổi hoặc chưa có lịch sử cài bởi launcher."))
        return checks

    def dependency_hashes(self):
        names = ["backend/requirements.txt", "backend/requirements-dev.txt", "frontend/package.json", "frontend/pnpm-lock.yaml"]
        return {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest()
                for name in names if (self.root / name).is_file()}

    def changed_dependencies(self):
        path = self.runtime / "installed.json"
        if not path.exists():
            return []
        try:
            installed = json.loads(path.read_text(encoding="utf-8"))
            return [key for key, value in self.dependency_hashes().items()
                    if not (key == "backend/requirements-dev.txt" and key not in installed)
                    and installed.get(key) != value]
        except (ValueError, OSError):
            return ["Lịch sử cài không đọc được"]

    def run_install(self, args, cwd):
        from project import WindowsJob

        directory = self.runtime / "logs"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"install-{datetime.now():%Y%m%d-%H%M%S-%f}.log"
        env = clean_aws_env()
        env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8", PIP_DISABLE_PIP_VERSION_CHECK="1", CI="true")
        print("Log:", path)
        # Pipe installer output through redaction before either displaying or storing it.
        job = WindowsJob()
        try:
            process = subprocess.Popen([str(a) for a in args], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       encoding="utf-8", errors="replace", start_new_session=os.name != "nt")
        except BaseException:
            job.close()
            raise
        try:
            job.assign(process)
            with path.open("w", encoding="utf-8") as stream:
                for raw in process.stdout:
                    line = redact(raw.rstrip())
                    print(line, flush=True)
                    stream.write(line + "\n")
            code = process.wait()
        except BaseException:
            # This handle belongs to the installer started immediately above.
            if process.poll() is None:
                if os.name == "nt":
                    job.close()
                    if process.poll() is None:
                        process.kill()
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=10)
            raise
        finally:
            job.close()
            process.stdout.close()
        if code:
            raise RuntimeError(f"Cài đặt thất bại (mã {code}). Xem log ở {path}.")

    def install(self, development=False):
        if sys.version_info < (3, 10):
            raise RuntimeError("Cần Python 3.10 trở lên.")
        if not self.node or not self.pnpm:
            raise RuntimeError("Cần cài Node.js và pnpm trước. Dùng mục hướng dẫn cài công cụ nền.")
        if not self.python.exists():
            self.run_install([sys.executable, "-m", "venv", self.root / "backend/.venv"], self.root)
        requirements = "requirements-dev.txt" if development else "requirements.txt"
        self.run_install([self.python, "-m", "pip", "install", "-r", requirements], self.root / "backend")
        self.run_install([self.pnpm, "install", "--frozen-lockfile"], self.root / "frontend")
        hashes = self.dependency_hashes()
        # Do not claim development requirements were installed in runtime-only mode.
        if not development:
            hashes.pop("backend/requirements-dev.txt", None)
        atomic_write(self.runtime / "installed.json", json.dumps(hashes, indent=2) + "\n")

    def install_pnpm(self):
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            raise RuntimeError("Cần cài Node.js (kèm npm) trước.")
        # Local tool directory: do not change globally installed npm packages.
        target = self.runtime / "tools"
        self.run_install([npm, "install", "--prefix", target, "--no-package-lock", "--no-audit", "--no-fund", "pnpm@10"], self.root)
        self.pnpm = str(target / "node_modules/.bin" / ("pnpm.cmd" if os.name == "nt" else "pnpm"))

    def use_local_tools(self):
        local = self.runtime / "tools/node_modules/.bin" / ("pnpm.cmd" if os.name == "nt" else "pnpm")
        if local.is_file():
            self.pnpm = str(local)

    def install_crt(self):
        code, version = self.backend_python("from importlib.metadata import version; print(version('botocore'))")
        if code or not re.fullmatch(r"\d+(?:\.\d+)+", version):
            raise RuntimeError("Cài requirements backend trước khi bổ sung CRT.")
        self.run_install([self.python, "-m", "pip", "install", f"botocore[crt]=={version}"], self.root / "backend")
