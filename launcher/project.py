"""Own server processes, logs and cleanup; never stop a process by port or image name."""
from __future__ import annotations

import ctypes
from datetime import datetime
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

from config import ROOT, RUNTIME
from environment import redact


class InstanceLock:
    def __init__(self, path):
        self.path = Path(path)
        self.stream = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.path.open("a+b")
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            stream.close()
            raise RuntimeError("Launcher của project này đang mở. Hãy dùng cửa sổ đang chạy.") from None
        self.stream = stream
        return self

    def __exit__(self, *_):
        if self.stream:
            self.stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
            self.stream.close()
            self.stream = None


class WindowsJob:
    """Windows closes this handle on launcher exit, killing all owned descendants."""
    def __init__(self):
        self.handle = None
        if os.name != "nt":
            return
        from ctypes import wintypes as wt

        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wt.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wt.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wt.DWORD), ("SchedulingClass", wt.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in
                        ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                         "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IO),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wt.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wt.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD]
        self.kernel.SetInformationJobObject.restype = wt.BOOL
        self.kernel.AssignProcessToJobObject.argtypes = [wt.HANDLE, wt.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wt.BOOL
        self.kernel.TerminateJobObject.argtypes = [wt.HANDLE, wt.UINT]
        self.kernel.TerminateJobObject.restype = wt.BOOL
        self.kernel.CloseHandle.argtypes = [wt.HANDLE]
        self.kernel.CloseHandle.restype = wt.BOOL
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Extended()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign(self, process):
        if self.handle and not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class Project:
    def __init__(self, settings, environment):
        self.settings, self.environment = settings, environment
        self.services = {}
        self.active = None
        self.job = None
        self.log_paths = {}
        self.threads = []

    def spawn(self, name, args, cwd, env):
        directory = self.settings.runtime / "logs"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{datetime.now():%Y%m%d-%H%M%S-%f}-{name}.log"
        process = subprocess.Popen([str(a) for a in args], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   encoding="utf-8", errors="replace",
                                   creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                                   start_new_session=os.name != "nt")
        self.services[name] = process
        self.log_paths[name] = path
        try:
            if self.job:
                self.job.assign(process)
        except BaseException:
            process.kill()
            process.wait(timeout=5)
            process.stdout.close()
            raise

        def collect():
            with path.open("w", encoding="utf-8", buffering=1) as stream:
                try:
                    for line in process.stdout:
                        stream.write(redact(line))
                finally:
                    process.stdout.close()

        thread = threading.Thread(target=collect, name=f"maysec-log-{name}", daemon=True)
        thread.start()
        self.threads.append(thread)
        return process

    @staticmethod
    def check_port(port):
        # Check both names used by CORS; binding is only a preflight, strictPort remains required.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                raise RuntimeError(f"Port {port} đang bị chiếm. Đổi port hoặc dừng ứng dụng đó; launcher không tự tắt nó.") from None

    def wait_ready(self, name, url, expected=None, timeout=40):
        deadline = time.monotonic() + timeout
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while time.monotonic() < deadline:
            dead = [key for key, proc in self.services.items() if proc.poll() is not None]
            if dead:
                raise RuntimeError("Tiến trình đã thoát khi khởi động: " + ", ".join(dead) + ". Xem mục log.")
            try:
                with opener.open(url, timeout=1) as response:
                    if response.status == 200:
                        if expected:
                            actual = json.loads(response.read(65536))
                            if any(actual.get(key) != value for key, value in expected.items()):
                                raise RuntimeError("/health không khớp cấu hình đã chọn; chưa xác nhận backend sẵn sàng.")
                        return
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError):
                pass
            time.sleep(.15)
        raise RuntimeError(f"{name} chưa sẵn sàng sau {timeout} giây. Xem mục log.")

    def start(self, resolved):
        if self.services:
            raise RuntimeError("Project đã có tiến trình. Dùng Khởi động lại hoặc Dừng trước.")
        env = self.environment
        if not env.node or not (self.settings.root / "frontend/node_modules/vite/bin/vite.js").is_file():
            raise RuntimeError("Thiếu Node.js hoặc dependency frontend. Vào mục Môi trường để chuẩn bị.")
        backend_needed = resolved["mode"] != "demo"
        if backend_needed and not env.python.is_file():
            raise RuntimeError("Chưa có backend .venv. Vào mục Môi trường để chuẩn bị.")
        if backend_needed:
            code, message = env.backend_python("from app.config import Settings; Settings.from_env(); print('OK')",
                                                env=self.settings.child_env(resolved, "backend"))
            if code:
                raise RuntimeError("Cấu hình backend không hợp lệ: " + message.splitlines()[-1])
        self.check_port(resolved["web_port"])
        if backend_needed:
            self.check_port(resolved["api_port"])
        self.job = WindowsJob()
        try:
            if backend_needed:
                self.spawn("API", [env.python, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
                                   "--port", str(resolved["api_port"])],
                           self.settings.root / "backend", self.settings.child_env(resolved, "backend"))
                self.wait_ready("Backend", f"http://127.0.0.1:{resolved['api_port']}/health",
                                {"storage": resolved["backend"]["MAYSEC_STORAGE_MODE"],
                                 "metadata_mode": resolved["backend"]["MAYSEC_METADATA_MODE"]})
            self.spawn("WEB", [env.node, self.settings.root / "frontend/node_modules/vite/bin/vite.js",
                               "--host", "127.0.0.1", "--port", str(resolved["web_port"]), "--strictPort"],
                       self.settings.root / "frontend", self.settings.child_env(resolved, "frontend"))
            self.wait_ready("Frontend", f"http://127.0.0.1:{resolved['web_port']}/")
            self.active = resolved
        except BaseException:
            self.stop()
            raise

    def stop(self):
        processes = list(self.services.values())
        for process in processes:
            if process.poll() is None:
                try:
                    if os.name == "nt":
                        process.send_signal(signal.CTRL_BREAK_EVENT)
                    else:
                        os.killpg(process.pid, signal.SIGTERM)
                except OSError:
                    pass
        deadline = time.monotonic() + 3
        for process in processes:
            if process.poll() is None:
                try:
                    process.wait(timeout=max(.01, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    pass
        if self.job:
            self.job.close()  # Also kills grandchildren after their parent exits.
            self.job = None
        if os.name != "nt":
            for process in processes:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for thread in self.threads:
            thread.join(timeout=2)
        self.services.clear()
        self.threads.clear()
        self.active = None

    def status(self):
        return {name: ("Đang chạy" if proc.poll() is None else f"Đã thoát ({proc.returncode})")
                for name, proc in self.services.items()}

    def tail(self, lines=30):
        output = []
        for name, path in self.log_paths.items():
            output.append(f"\n[{name}] {path}")
            if path.exists():
                # Keep memory bounded even for a long-running development server.
                with path.open("rb") as stream:
                    stream.seek(0, 2)
                    stream.seek(max(0, stream.tell() - 32768))
                    text = stream.read().decode("utf-8", errors="replace")
                output.extend(text.splitlines()[-lines:])
        return "\n".join(output) or "Chưa có log trong phiên launcher này."
