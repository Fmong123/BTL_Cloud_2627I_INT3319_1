"""AWS CLI login flows, targeted profile updates and read-only identity checks."""
from __future__ import annotations

import configparser
import json
import os
from pathlib import Path
import re
import subprocess

from config import atomic_write, clean_aws_env
from environment import capture

AUTH_KEYS = {"login_session", "sso_session", "sso_start_url", "sso_region", "sso_account_id",
             "sso_role_name", "role_arn", "source_profile", "credential_source", "credential_process",
             "web_identity_token_file", "aws_access_key_id", "aws_secret_access_key", "aws_session_token"}


def aws_paths():
    return (Path(os.environ.get("AWS_CONFIG_FILE", str(Path.home() / ".aws/config"))).expanduser(),
            Path(os.environ.get("AWS_SHARED_CREDENTIALS_FILE", str(Path.home() / ".aws/credentials"))).expanduser())


def read_ini(path):
    parser = configparser.RawConfigParser()
    try:
        parser.read(path, encoding="utf-8-sig")
    except configparser.Error:
        raise ValueError(f"Cấu hình AWS không hợp lệ: {path}. Giữ file để kiểm tra.") from None
    return parser


def patch_ini(path: Path, section: str, updates: dict, removals=()):
    """Preserve unrelated profiles, comments and sections; atomically replace one file."""
    read_ini(path)
    text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    lines = text.splitlines(keepends=True)
    start, end = None, len(lines)
    for index, line in enumerate(lines):
        match = re.match(r"\s*\[([^\]]+)\]", line)
        if match:
            if start is not None:
                end = index
                break
            if match[1] == section:
                start = index
    if start is None:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines += [f"\n[{section}]\n"] + [f"{key} = {value}\n" for key, value in updates.items()]
    else:
        remove = set(removals) | set(updates)
        kept, skip_continuation = [], False
        for line in lines[start + 1:end]:
            match = re.match(r"\s*([A-Za-z_][A-Za-z_0-9-]*)\s*[=:]", line)
            if match:
                skip_continuation = match[1].lower() in remove
            elif line and not line[0].isspace():
                skip_continuation = False
            if not skip_continuation or line.lstrip().startswith(("#", ";")):
                kept.append(line)
        block = [lines[start]] + kept
        if block and not block[-1].endswith("\n"):
            block[-1] += "\n"
        block += [f"{key} = {value}\n" for key, value in updates.items()]
        lines[start:end] = block
    output = "".join(lines)
    check = configparser.RawConfigParser()
    check.read_string(output)
    atomic_write(path, output)
    if os.name != "nt":
        path.chmod(0o600)


class AwsProfiles:
    def __init__(self, environment):
        self.environment = environment
        self.status = {}

    def require_cli(self):
        if not self.environment.aws:
            raise RuntimeError("Chưa có AWS CLI. Cài AWS CLI v2 rồi mở lại launcher.")
        return self.environment.aws

    def profiles(self):
        cli = self.require_cli()
        code, message = capture([cli, "configure", "list-profiles"], env=clean_aws_env(), timeout=12)
        if code:
            raise RuntimeError("Không liệt kê được profile AWS: " + message)
        return sorted(set(line.strip() for line in message.splitlines() if line.strip()))

    def kind(self, profile):
        config_path, credentials_path = aws_paths()
        config, credentials = read_ini(config_path), read_ini(credentials_path)
        section = "default" if profile == "default" else "profile " + profile
        keys = set(config.options(section)) if config.has_section(section) else set()
        keys |= set(credentials.options(profile)) if credentials.has_section(profile) else set()
        for marker, label in (("login_session", "Console login"), ("sso_session", "SSO"),
                              ("sso_start_url", "SSO"), ("role_arn", "Assume role"),
                              ("credential_process", "Credential process"), ("aws_access_key_id", "Access Key")):
            if marker in keys:
                return label
        return "Chưa có phương thức xác thực"

    @staticmethod
    def validate_name(name):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}", name):
            raise ValueError("Tên profile mới: 1–64 ký tự chữ/số, dấu chấm, _, @ hoặc -.")

    def login(self, profile, method="auto"):
        self.validate_name(profile)
        cli = self.require_cli()
        kind = self.kind(profile) if method == "auto" else method
        if kind in ("SSO", "sso"):
            args = [cli, "sso", "login", "--profile", profile]
        elif kind in ("Console login", "console"):
            args = [cli, "login", "--profile", profile]
        else:
            raise RuntimeError("Profile này không có phiên trình duyệt để đăng nhập lại. Với Access Key, chọn cập nhật key hoặc kiểm tra danh tính.")
        # Authentication stays in the native CLI/browser, never in a captured log.
        code = subprocess.call(args, env=clean_aws_env())
        self.status.pop(profile, None)
        if code:
            raise RuntimeError("Chưa hoàn tất đăng nhập AWS. Kiểm tra quyền đăng nhập hoặc thử lại.")

    def configure_sso(self, profile):
        self.validate_name(profile)
        code = subprocess.call([self.require_cli(), "configure", "sso", "--profile", profile], env=clean_aws_env())
        self.status.pop(profile, None)
        if code:
            raise RuntimeError("Chưa hoàn tất cấu hình SSO.")

    def save_keys(self, profile, access_key, secret_key, session_token, region):
        self.validate_name(profile)
        if not access_key or not secret_key or any(c.isspace() for c in access_key + secret_key + session_token):
            raise ValueError("Key/secret bắt buộc, không chứa khoảng trắng.")
        if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", region):
            raise ValueError("Region không hợp lệ, ví dụ ap-southeast-2.")
        config_path, credentials_path = aws_paths()
        # Validate both first, so an existing malformed file is never overwritten.
        read_ini(config_path)
        read_ini(credentials_path)
        section = "default" if profile == "default" else "profile " + profile
        values = {"aws_access_key_id": access_key, "aws_secret_access_key": secret_key}
        if session_token:
            values["aws_session_token"] = session_token
        patch_ini(credentials_path, profile, values, AUTH_KEYS)
        patch_ini(config_path, section, {"region": region, "output": "json"}, AUTH_KEYS)
        self.status.pop(profile, None)

    def identity(self, profile, sdk=True):
        args = [self.require_cli(), "sts", "get-caller-identity", "--profile", profile,
                "--region", "ap-southeast-2", "--output", "json", "--no-cli-pager",
                "--cli-connect-timeout", "5", "--cli-read-timeout", "10"]
        code, output = capture(args, env=clean_aws_env(), timeout=35)
        if code:
            self.status[profile] = {"ok": False, "message": "Xác thực lỗi / phiên hết hạn / lỗi mạng"}
            raise RuntimeError("Không kiểm tra được danh tính AWS.\n" + output)
        try:
            identity = json.loads(output)
            result = {"ok": True, "Account": identity["Account"], "Arn": identity["Arn"], "sdk": False}
        except (ValueError, KeyError, TypeError):
            raise RuntimeError("AWS CLI không trả về danh tính hợp lệ.") from None
        self.status[profile] = result
        if sdk:
            script = """
import json, sys
import boto3
from botocore.config import Config
try:
    client = boto3.Session(profile_name=sys.argv[1]).client('sts', region_name='ap-southeast-2', config=Config(connect_timeout=5, read_timeout=10, retries={'max_attempts': 0}))
    answer = client.get_caller_identity()
    print(json.dumps({'Account': answer['Account'], 'Arn': answer['Arn']}))
except Exception as exc:
    print(json.dumps({'error': type(exc).__name__}))
    sys.exit(1)
"""
            code, output = self.environment.backend_python(script, args=(profile,), env=clean_aws_env(), timeout=35)
            if code:
                raise RuntimeError("CLI xác thực được, nhưng backend Python chưa dùng được profile. Kiểm tra requirements/phiên đăng nhập; Console login có thể cần botocore[crt].\n" + output)
            try:
                sdk_identity = json.loads(output)
            except ValueError:
                raise RuntimeError("Backend không trả về kết quả kiểm tra hợp lệ.") from None
            if any(sdk_identity.get(key) != result[key] for key in ("Account", "Arn")):
                raise RuntimeError("Danh tính AWS CLI và backend không khớp; chưa cho phép dùng cấu hình này.")
            result["sdk"] = True
        return result

    def resources(self, resolved):
        backend = resolved["backend"]
        profile = backend["AWS_PROFILE"]
        self.identity(profile)
        requests = []
        if backend["MAYSEC_STORAGE_MODE"] == "s3":
            if not backend["S3_BUCKET_NAME"] or not backend["AWS_REGION"]:
                raise ValueError("Điền bucket và region S3 trong cấu hình trước.")
            requests.append(("S3 bucket", ["s3api", "head-bucket", "--bucket", backend["S3_BUCKET_NAME"], "--region", backend["AWS_REGION"]]))
        if backend["MAYSEC_METADATA_MODE"] == "dynamodb":
            for key in ("DYNAMODB_FILES_TABLE", "DYNAMODB_AUDIT_TABLE", "DYNAMODB_USERS_TABLE"):
                requests.append((backend[key], ["dynamodb", "describe-table", "--table-name", backend[key],
                                 "--region", backend["DYNAMODB_REGION"], "--query", "Table.TableStatus", "--output", "text"]))
        results = []
        for label, command in requests:
            code, output = capture([self.require_cli(), *command, "--profile", profile, "--no-cli-pager",
                                    "--cli-connect-timeout", "5", "--cli-read-timeout", "10"], env=clean_aws_env(), timeout=25)
            results.append((label, code == 0, output or "Phản hồi thành công"))
        return results
