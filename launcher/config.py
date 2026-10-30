"""Launcher-owned settings; application ENV files are read, never rewritten."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
from decimal import Decimal, InvalidOperation

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(__file__).resolve().parent / "runtime"
MB = 1_000_000
MODES = {
    "demo": ("Demo — chỉ giao diện", None, "disabled"),
    "local": ("Local — không AWS", "local", "disabled"),
    "local-db": ("Local + DynamoDB", "local", "dynamodb"),
    "s3-db": ("S3 + DynamoDB", "s3", "dynamodb"),
}
BACKEND_DEFAULTS = {
    "MAYSEC_STORAGE_MODE": "unconfigured", "MAYSEC_METADATA_MODE": "disabled",
    "MAYSEC_SCAN_PIPELINE_ENABLED": "false", "MAYSEC_LOCAL_STORAGE_DIR": "data",
    "MAYSEC_MAX_FILE_SIZE_BYTES": str(100 * MB),
    "MAYSEC_CORS_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
    "AWS_PROFILE": "", "S3_BUCKET_NAME": "", "AWS_REGION": "",
    "DYNAMODB_REGION": "ap-southeast-2", "DYNAMODB_FILES_TABLE": "securedrive-files",
    "DYNAMODB_AUDIT_TABLE": "securedrive-audit-log", "DYNAMODB_USERS_TABLE": "securedrive-users",
    "MAYSEC_S3_MULTIPART_THRESHOLD_BYTES": "16777216",
    "MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES": "8388608", "MAYSEC_S3_MAX_CONCURRENCY": "2",
}
FRONTEND_DEFAULTS = {
    "VITE_UPLOAD_MODE": "demo", "VITE_API_BASE_URL": "http://127.0.0.1:8000",
    "VITE_MAX_FILE_SIZE_MB": "100",
}
EDITABLE = set(BACKEND_DEFAULTS) - {
    "MAYSEC_STORAGE_MODE", "MAYSEC_METADATA_MODE", "MAYSEC_MAX_FILE_SIZE_BYTES",
    "MAYSEC_CORS_ORIGINS",
}
AWS_FILE_ENV = {
    "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_LOGIN_CACHE_DIRECTORY",
    "AWS_CA_BUNDLE",
}


def read_env(path: Path) -> dict[str, str]:
    """Literal dotenv values, quotes, BOM, export and comments; no shell evaluation."""
    if not path.is_file():
        return {}
    values = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)", line)
        if not match:
            raise ValueError(f"{path.name}, dòng {number}: cần cú pháp TEN_BIEN=gia_tri.")
        key, value = match.groups()
        if value.startswith(("'", '"')):
            quote = value[0]
            end = 1
            while end < len(value):
                if value[end] == quote and (quote == "'" or len(re.search(r"\\*$", value[:end]).group()) % 2 == 0):
                    break
                end += 1
            if end == len(value) or (value[end + 1:].strip() and not value[end + 1:].lstrip().startswith("#")):
                raise ValueError(f"{path.name}, dòng {number}: dấu nháy không hợp lệ (chỉ hỗ trợ một dòng).")
            value = value[1:end]
            if quote == '"':
                escapes = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}
                value = re.sub(r'\\([nrt"\\])', lambda m: escapes[m[1]], value)
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        if "${" in value:
            raise ValueError(f"{path.name}, dòng {number}: launcher cần giá trị trực tiếp, không dùng ${{...}}.")
        values[key] = value
    return values


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".maysec-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def clean_aws_env(base=None, profile: str = "") -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    for key in list(env):
        if key.startswith("AWS_") and key not in AWS_FILE_ENV:
            env.pop(key)
    env.update(AWS_EC2_METADATA_DISABLED="true", AWS_PAGER="", AWS_CLI_AUTO_PROMPT="off")
    if profile:
        env["AWS_PROFILE"] = profile
    return env


class Settings:
    def __init__(self, root: Path = ROOT, runtime: Path = RUNTIME):
        self.root, self.runtime = Path(root), Path(runtime)
        self.path = self.runtime / "settings.json"
        self.data = {"version": 1, "mode": "local", "web_port": 5173, "api_port": 8000,
                     "max_file_mb": None, "overrides": {}}
        if self.path.exists():
            try:
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                if not isinstance(saved, dict) or set(saved) - set(self.data):
                    raise ValueError("Trường cấu hình không hợp lệ.")
                self.data.update(saved)
            except (ValueError, TypeError) as exc:
                raise ValueError("Không đọc được launcher/runtime/settings.json; giữ file để kiểm tra.") from exc
        self.validate()

    def validate(self):
        d = self.data
        if d["version"] != 1 or d["mode"] not in MODES:
            raise ValueError("Phiên bản hoặc chế độ launcher không hợp lệ.")
        for key in ("web_port", "api_port"):
            if type(d[key]) is not int or not 1024 <= d[key] <= 65535:
                raise ValueError("Port phải là số nguyên từ 1024 đến 65535.")
        if d["web_port"] == d["api_port"]:
            raise ValueError("Frontend và backend phải dùng hai port khác nhau.")
        if d["max_file_mb"] is not None:
            self.size_bytes(d["max_file_mb"])
        if not isinstance(d["overrides"], dict) or set(d["overrides"]) - EDITABLE:
            raise ValueError("Cấu hình launcher chứa trường không được hỗ trợ.")
        if any(not isinstance(v, str) or any(c in v for c in "\r\n\x00") for v in d["overrides"].values()):
            raise ValueError("Giá trị cấu hình phải là chuỗi trên một dòng.")

    @staticmethod
    def size_bytes(value) -> int:
        try:
            amount = Decimal(str(value))
            if not amount.is_finite() or not 0 < amount <= 100 or amount * MB != int(amount * MB):
                raise ValueError
            return int(amount * MB)
        except (ValueError, InvalidOperation, OverflowError):
            raise ValueError("Dung lượng phải lớn hơn 0, tối đa 100 MB mỗi tệp và tương ứng số byte nguyên.") from None

    def save(self):
        self.validate()
        atomic_write(self.path, json.dumps(self.data, ensure_ascii=False, indent=2) + "\n")

    def resolve(self, parent=None):
        self.validate()
        parent = os.environ if parent is None else parent
        backend, frontend = dict(BACKEND_DEFAULTS), dict(FRONTEND_DEFAULTS)
        sources = {key: "Mặc định" for key in backend | frontend}

        def merge(target, values, source):
            for key in target.keys() & values.keys():
                target[key] = values[key]
                sources[key] = source

        merge(backend, read_env(self.root / "backend/.env"), "backend/.env")
        for filename in (".env", ".env.local", ".env.development", ".env.development.local"):
            merge(frontend, read_env(self.root / "frontend" / filename), f"frontend/{filename}")
        merge(backend, parent, "Terminal")
        merge(frontend, parent, "Terminal")
        merge(backend, self.data["overrides"], "Launcher đã lưu")
        _, storage, metadata = MODES[self.data["mode"]]

        def put(target, key, value, source="Launcher · theo chế độ"):
            target[key], sources[key] = str(value), source

        put(backend, "MAYSEC_STORAGE_MODE", storage or "unconfigured")
        put(backend, "MAYSEC_METADATA_MODE", metadata)
        put(frontend, "VITE_UPLOAD_MODE", "demo" if storage is None else "api")
        put(frontend, "VITE_API_BASE_URL", f"http://127.0.0.1:{self.data['api_port']}", "Launcher · đồng bộ port")
        if self.data["max_file_mb"] is not None:
            size = self.size_bytes(self.data["max_file_mb"])
            size_source = "Launcher đã lưu"
        elif sources["MAYSEC_MAX_FILE_SIZE_BYTES"] != "Mặc định":
            size = min(int(backend["MAYSEC_MAX_FILE_SIZE_BYTES"]), 100 * MB)
            self.size_bytes(Decimal(size) / MB)
            size_source = sources["MAYSEC_MAX_FILE_SIZE_BYTES"]
        else:
            size = self.size_bytes(frontend["VITE_MAX_FILE_SIZE_MB"])
            size_source = sources["VITE_MAX_FILE_SIZE_MB"]
        put(backend, "MAYSEC_MAX_FILE_SIZE_BYTES", size, size_source)
        put(frontend, "VITE_MAX_FILE_SIZE_MB", format(Decimal(size) / MB, "f"), "Launcher · đồng bộ giới hạn")
        origins = [v.strip() for v in backend["MAYSEC_CORS_ORIGINS"].split(",") if v.strip()]
        origins += [f"http://127.0.0.1:{self.data['web_port']}", f"http://localhost:{self.data['web_port']}"]
        put(backend, "MAYSEC_CORS_ORIGINS", ",".join(dict.fromkeys(origins)), "Launcher · đồng bộ CORS")
        if self.data["mode"] != "s3-db":
            put(backend, "MAYSEC_SCAN_PIPELINE_ENABLED", "false")
        if metadata == "disabled":
            put(backend, "AWS_PROFILE", "", "Không dùng AWS trong chế độ này")
        return {"mode": self.data["mode"], "backend": backend, "frontend": frontend,
                "web_port": self.data["web_port"], "api_port": self.data["api_port"], "sources": sources}

    def child_env(self, resolved, service: str, parent=None):
        # A frontend process never inherits the backend's AWS credentials or settings.
        env = clean_aws_env(parent)
        for key in list(env):
            if key.startswith(("VITE_", "MAYSEC_", "DYNAMODB_", "S3_")):
                env.pop(key)
        env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        env.update(resolved[service])
        if service == "frontend":
            for key in list(env):
                if key.startswith("AWS_"):
                    env.pop(key)
        elif not resolved["backend"]["AWS_PROFILE"]:
            env.pop("AWS_PROFILE", None)
        return env
