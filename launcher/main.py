"""MaySec's terminal launcher. Run MaySec.cmd or python launcher/main.py."""
from __future__ import annotations

import argparse
from copy import deepcopy
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys
import webbrowser

from aws_profiles import AwsProfiles
from config import MODES, ROOT, RUNTIME, Settings, read_env
from environment import Environment, redact
from project import InstanceLock, Project


def screen(title):
    print("\n" + "=" * 76)
    print(" " + title)
    print("=" * 76)


def ask(label):
    return input(label).strip()


def pause():
    input("\nNhấn Enter để tiếp tục…")


def attempt(action):
    try:
        action()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print("\nLỖI:", redact(str(exc)))
    pause()


class Launcher:
    def __init__(self, settings=None):
        self.settings = settings or Settings()
        self.environment = Environment(self.settings.root, self.settings.runtime)
        self.environment.use_local_tools()
        self.aws = AwsProfiles(self.environment)
        self.project = Project(self.settings, self.environment)

    def configured_profile(self):
        return (self.settings.data["overrides"].get("AWS_PROFILE")
                if "AWS_PROFILE" in self.settings.data["overrides"] else
                os.environ.get("AWS_PROFILE", read_env(self.settings.root / "backend/.env").get("AWS_PROFILE", "")))

    def show_config(self, resolved=None):
        resolved = resolved or self.settings.resolve()
        screen("CẤU HÌNH SẼ ÁP DỤNG")
        print("Chế độ:", MODES[resolved["mode"]][0])
        print(f"Port WEB: {resolved['web_port']} | API: {resolved['api_port']}")
        print("Thứ tự: mặc định < file ENV < terminal < launcher đã lưu < chế độ/đồng bộ.")
        print("Giới hạn hiển thị MB dùng 1 MB = 1048576 byte, giống ứng dụng hiện tại.")
        for name in ("backend", "frontend"):
            print(f"\n{name.upper()}")
            for key, value in resolved[name].items():
                print(f"  {key}\n    {value or '(trống)'}  [{resolved['sources'][key]}]")
        if self.project.active:
            changed = any(resolved[key] != self.project.active[key] for key in
                          ("mode", "web_port", "api_port", "backend", "frontend"))
            print("\n" + ("Cần KHỞI ĐỘNG LẠI để áp dụng thay đổi." if changed else "Cấu hình khớp phiên đang chạy."))
        print("\nENV gốc được giữ nguyên; cấu hình hiệu lực chỉ truyền cho các tiến trình con.")

    def update(self, change):
        old = deepcopy(self.settings.data)
        try:
            change(self.settings.data)
            self.settings.validate()
            self.settings.resolve()
            self.settings.save()
        except BaseException:
            self.settings.data = old
            raise
        print("Đã lưu cấu hình launcher." + (" Cần khởi động lại project để áp dụng." if self.project.services else ""))

    def edit_mode(self):
        screen("CHỌN CHẾ ĐỘ CHẠY")
        options = list(MODES)
        for index, mode in enumerate(options, 1):
            print(f" [{index}] {MODES[mode][0]}")
        print(" [0] Quay lại")
        choice = ask("Chọn: ")
        if choice == "0":
            return
        if not choice.isdigit() or not 1 <= int(choice) <= len(options):
            raise ValueError("Lựa chọn không hợp lệ.")
        self.update(lambda data: data.update(mode=options[int(choice) - 1]))

    def choose_profile(self):
        profiles = self.aws.profiles()
        screen(f"CHỌN AWS PROFILE — {len(profiles)} PROFILE")
        for index, name in enumerate(profiles, 1):
            print(f" [{index}] {name} — {self.aws.kind(name)}")
        if not profiles:
            print("Chưa có profile. Vào Tài khoản AWS để tạo.")
            return
        print(" [0] Quay lại")
        choice = ask("Chọn: ")
        if choice == "0":
            return
        if not choice.isdigit() or not 1 <= int(choice) <= len(profiles):
            raise ValueError("Lựa chọn không hợp lệ.")
        name = profiles[int(choice) - 1]
        self.update(lambda data: data["overrides"].update(AWS_PROFILE=name))
        print("Profile đã chọn:", name)

    def edit_fields(self, fields):
        resolved = self.settings.resolve()["backend"]
        changes = {}
        for key, label in fields:
            value = ask(f"{label} [{resolved[key]}] (Enter giữ nguyên; dấu - để xóa): ")
            if value:
                changes[key] = "" if value == "-" else value
        self.update(lambda data: data["overrides"].update(changes))

    def edit_config(self):
        while True:
            screen("XEM / CHỈNH CẤU HÌNH ENV")
            print(" [1] Xem toàn bộ cấu hình hiệu lực và nguồn")
            print(" [2] Đổi port frontend / backend")
            print(" [3] Đổi giới hạn dung lượng file")
            print(" [4] Đổi thư mục lưu local")
            print(" [5] Chỉnh S3 / DynamoDB")
            print(" [6] Chọn AWS profile")
            print(" [7] Bật / tắt cờ pipeline quét")
            print(" [8] Bỏ các giá trị launcher ghi đè, đọc lại ENV (giữ chế độ)")
            print(" [9] Chỉnh ARN workflow quét lại")
            print(" [0] Quay lại")
            choice = ask("Chọn: ")
            if choice == "0":
                return

            def action():
                if choice == "1":
                    self.show_config()
                elif choice == "2":
                    data = self.settings.data
                    web = int(ask(f"Port frontend [{data['web_port']}]: ") or data["web_port"])
                    api = int(ask(f"Port backend [{data['api_port']}]: ") or data["api_port"])
                    self.update(lambda d: d.update(web_port=web, api_port=api))
                elif choice == "3":
                    value = ask("Giới hạn MB (ví dụ 50 hoặc 0.5): ")
                    self.settings.size_bytes(value)
                    self.update(lambda d: d.update(max_file_mb=value))
                elif choice == "4":
                    self.edit_fields([("MAYSEC_LOCAL_STORAGE_DIR", "Thư mục, tương đối tính từ backend/")])
                elif choice == "5":
                    self.edit_fields([("S3_BUCKET_NAME", "Bucket S3"), ("AWS_REGION", "Region S3"),
                                      ("MAYSEC_QUARANTINE_BUCKET_NAME", "Bucket cách ly"),
                                      ("DYNAMODB_FILES_TABLE", "Bảng files"), ("DYNAMODB_AUDIT_TABLE", "Bảng audit"),
                                      ("DYNAMODB_USERS_TABLE", "Bảng users")])
                    print("DynamoDB của project dùng cố định ap-southeast-2.")
                elif choice == "6":
                    self.choose_profile()
                elif choice == "7":
                    if self.settings.data["mode"] != "s3-db":
                        raise ValueError("Cờ pipeline chỉ có hiệu lực trong S3 + DynamoDB.")
                    print("Cờ này không tạo/bật/tắt EventBridge, Step Functions hoặc Lambda trên AWS.")
                    print("Chỉ bật khi hạ tầng và writer DB của nhóm đã sẵn sàng.")
                    value = ask("Bật pipeline? (y/N): ").lower() == "y"
                    self.update(lambda d: d["overrides"].update(MAYSEC_SCAN_PIPELINE_ENABLED=str(value).lower()))
                elif choice == "8":
                    if ask("Bỏ ghi đè của launcher? (y/N): ").lower() == "y":
                        self.update(lambda d: d.update(overrides={}, web_port=5173, api_port=8000, max_file_mb=None))
                elif choice == "9":
                    print("Quét lại chỉ có hiệu lực khi dùng S3 + DynamoDB và pipeline đã bật.")
                    self.edit_fields([("MAYSEC_RESCAN_STATE_MACHINE_ARN", "ARN workflow STANDARD (Sydney)")])
                else:
                    raise ValueError("Lựa chọn không hợp lệ.")
            attempt(action)

    def environment_menu(self):
        while True:
            screen("MÔI TRƯỜNG / THƯ VIỆN")
            print(" [1] Kiểm tra toàn bộ môi trường")
            print(" [2] Chuẩn bị / sửa thư viện chạy backend + frontend")
            print(" [3] Cài thêm thư viện kiểm thử backend + frontend")
            print(" [4] Cài pnpm riêng cho launcher (không cài global)")
            print(" [5] Bổ sung CRT cho AWS Console login của backend")
            print(" [6] Hướng dẫn cài Python / Node.js / AWS CLI")
            print(" [7] Xem thư mục log cài đặt")
            print(" [0] Quay lại")
            choice = ask("Chọn: ")
            if choice == "0":
                return

            def action():
                if choice == "1":
                    print("Đang kiểm tra…", flush=True)
                    for name, ok, detail in self.environment.inspect():
                        print(f"\n [{'OK' if ok else 'CẦN KIỂM TRA'}] {name}\n   {detail}")
                elif choice in {"2", "3", "4", "5"}:
                    if self.project.services:
                        raise RuntimeError("Dừng project trước khi thay đổi thư viện.")
                    print("Sẽ tải/cài thư viện cục bộ; không sửa requirements hoặc lockfile nguồn.")
                    if ask("Tiếp tục cài đặt? (y/N): ").lower() != "y":
                        return
                    if choice in {"2", "3"}:
                        self.environment.install(development=choice == "3")
                    elif choice == "4":
                        self.environment.install_pnpm()
                    else:
                        self.environment.install_crt()
                    print("Hoàn tất.")
                elif choice == "6":
                    print("Python 3.10+: https://www.python.org/downloads/windows/")
                    print("Node.js 22+: https://nodejs.org/en/download")
                    print("AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html")
                    print("Sau khi cài công cụ nền, đóng và mở lại MaySec.cmd để nhận PATH mới.")
                elif choice == "7":
                    self.open_folder(self.settings.runtime / "logs")
                else:
                    raise ValueError("Lựa chọn không hợp lệ.")
            attempt(action)

    def new_profile(self, method):
        name = ask("Tên profile: ")
        self.aws.validate_name(name)
        if name in self.aws.profiles():
            print("Tên này đã tồn tại. Thao tác sẽ cập nhật phương thức đăng nhập của profile này.")
            if ask("Nhập lại đúng tên để tiếp tục: ") != name:
                return
        if method == "console":
            # Avoid switching a key/role profile into a mixed credential configuration.
            if name in self.aws.profiles() and self.aws.kind(name) not in {"Console login", "Chưa có phương thức xác thực"}:
                raise ValueError("Hãy chọn tên mới cho Console login để giữ nguyên profile key/SSO/role cũ.")
            self.aws.login(name, method="console")
        elif method == "sso":
            if name in self.aws.profiles() and self.aws.kind(name) not in {"SSO", "Chưa có phương thức xác thực"}:
                raise ValueError("Hãy chọn tên mới cho SSO để giữ nguyên profile key/Console/role cũ.")
            self.aws.configure_sso(name)
        else:
            if not sys.stdin.isatty():
                raise RuntimeError("Nhập Access Key cần cửa sổ terminal trực tiếp để ẩn các trường nhập.")
            print("Key chỉ nhập trên máy này. Các trường nhập sẽ được ẩn và không ghi vào log.")
            access = getpass.getpass("Access Key ID: ").strip()
            secret = getpass.getpass("Secret Access Key: ").strip()
            token = getpass.getpass("Session Token (Enter nếu không có): ").strip()
            region = ask("Region mặc định [ap-southeast-2]: ") or "ap-southeast-2"
            try:
                self.aws.save_keys(name, access, secret, token, region)
            finally:
                access = secret = token = ""
        print("Đã thiết lập profile:", name)
        self.update(lambda data: data["overrides"].update(AWS_PROFILE=name))
        print("Chọn Kiểm tra danh tính để xác nhận tài khoản và khả năng backend dùng profile.")

    def required_profile(self):
        profile = self.configured_profile()
        if not profile:
            raise ValueError("Chọn AWS profile trước.")
        return profile

    def show_identity(self):
        profile = self.required_profile()
        print("Đang kiểm tra AWS CLI và backend Python…", flush=True)
        result = self.aws.identity(profile)
        print("Profile:", profile)
        print("Account ID:", result["Account"])
        print("IAM identity:", result["Arn"])
        print("Backend Python: OK")

    def aws_menu(self):
        while True:
            screen("TÀI KHOẢN AWS / PROFILE")
            try:
                profiles = self.aws.profiles()
                print(f"Có {len(profiles)} profile (số profile không phải số tài khoản AWS).")
                for name in profiles:
                    result = self.aws.status.get(name, {})
                    label = ("CLI + Backend OK" if result.get("sdk") else "CLI OK, backend chưa xác nhận") if result.get("ok") else result.get("message", "Chưa kiểm tra")
                    print(f"  {name} | {self.aws.kind(name)} | {label} | {result.get('Account', '—')}")
            except (ValueError, RuntimeError, OSError) as exc:
                print(redact(str(exc)))
            print("\nProfile đã chọn:", self.configured_profile() or "Chưa chọn")
            print(" [1] Chọn profile có sẵn")
            print(" [2] Tạo profile / đăng nhập bằng trình duyệt")
            print(" [3] Tạo profile IAM Identity Center / SSO")
            print(" [4] Tạo / cập nhật profile Access Key")
            print(" [5] Đăng nhập lại profile đã chọn")
            print(" [6] Kiểm tra danh tính / Account ID / backend")
            print(" [7] Kiểm tra kết nối S3 / DynamoDB theo chế độ")
            print(" [8] Làm mới danh sách")
            print(" [0] Quay lại")
            choice = ask("Chọn: ")
            if choice == "0":
                return

            def action():
                if choice == "1":
                    self.choose_profile()
                elif choice in {"2", "3", "4"}:
                    self.new_profile({"2": "console", "3": "sso", "4": "keys"}[choice])
                elif choice == "5":
                    self.aws.login(self.required_profile())
                elif choice == "6":
                    self.show_identity()
                elif choice == "7":
                    resolved = self.settings.resolve()
                    if resolved["mode"] not in {"local-db", "s3-db"}:
                        raise ValueError("Chọn Local + DynamoDB hoặc S3 + DynamoDB để kiểm tra tài nguyên theo chế độ.")
                    for name, ok, detail in self.aws.resources(resolved):
                        print(f" [{'OK' if ok else 'KHÔNG XÁC NHẬN ĐƯỢC'}] {name}: {detail}")
                    print("Các phép đọc/mô tả này không chứng minh quyền upload/ghi DB hoặc toàn pipeline.")
                elif choice == "8":
                    print("Đã làm mới; trạng thái xác thực chỉ cập nhật khi kiểm tra danh tính.")
                else:
                    raise ValueError("Lựa chọn không hợp lệ.")
            attempt(action)

    @staticmethod
    def open_folder(path):
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(path)
        else:
            print(path)

    def start(self, open_browser=True):
        if self.project.services:
            raise RuntimeError("Project đã có tiến trình. Chọn Khởi động lại hoặc Dừng trước.")
        resolved = self.settings.resolve()
        self.show_config(resolved)
        if resolved["mode"] in {"local-db", "s3-db"}:
            profile = resolved["backend"]["AWS_PROFILE"]
            if not profile:
                raise ValueError("Chọn AWS profile trong cấu hình trước khi chạy chế độ AWS.")
            if profile not in self.aws.profiles():
                raise ValueError("Profile đã chọn không tồn tại. Vào AWS / Profile để tạo hoặc chọn lại.")
            self.show_identity()
        print("\nĐang khởi động…", flush=True)
        self.project.start(resolved)
        print("Frontend:", f"http://127.0.0.1:{resolved['web_port']}/")
        if resolved["mode"] != "demo":
            print("Swagger:", f"http://127.0.0.1:{resolved['api_port']}/docs")
            print("/health xác nhận app/config; chưa chứng minh upload hoặc pipeline đã hoàn tất.")
        if open_browser:
            webbrowser.open(f"http://127.0.0.1:{resolved['web_port']}/")

    def running_menu(self):
        while True:
            screen("TRẠNG THÁI / NHẬT KÝ")
            for name, status in self.project.status().items():
                print(name + ":", status)
            if not self.project.services:
                print("Project đã dừng.")
            print(" [1] Xem log gần nhất")
            print(" [2] Mở giao diện web")
            print(" [3] Mở Swagger")
            print(" [4] Mở thư mục lưu local")
            print(" [5] Mở thư mục log")
            print(" [6] Xem cấu hình đang chạy")
            print(" [0] Về menu chính — tiếp tục giữ project chạy")
            choice = ask("Chọn: ")
            if choice == "0":
                return

            def action():
                active = self.project.active
                if choice == "1":
                    print(self.project.tail())
                elif choice in {"2", "3"}:
                    if not active:
                        raise RuntimeError("Khởi động project trước.")
                    if choice == "3" and active["mode"] == "demo":
                        raise RuntimeError("Demo không chạy backend.")
                    webbrowser.open(f"http://127.0.0.1:{active['web_port']}/" if choice == "2" else f"http://127.0.0.1:{active['api_port']}/docs")
                elif choice == "4":
                    resolved = active or self.settings.resolve()
                    if resolved["backend"]["MAYSEC_STORAGE_MODE"] != "local":
                        raise RuntimeError("Chế độ này không lưu file local.")
                    directory = Path(resolved["backend"]["MAYSEC_LOCAL_STORAGE_DIR"])
                    self.open_folder(directory if directory.is_absolute() else self.settings.root / "backend" / directory)
                elif choice == "5":
                    self.open_folder(self.settings.runtime / "logs")
                elif choice == "6":
                    if not active:
                        raise RuntimeError("Chưa có phiên đang chạy.")
                    self.show_config(active)
                else:
                    raise ValueError("Lựa chọn không hợp lệ.")
            attempt(action)

    def menu(self):
        while True:
            resolved = self.settings.resolve()
            screen("MAYSEC LAUNCHER")
            print("Project:", self.settings.root)
            print("Chế độ đã chọn:", MODES[self.settings.data["mode"]][0])
            print(f"Frontend: http://127.0.0.1:{resolved['web_port']}/")
            print("Backend:", "Không dùng trong Demo" if resolved["mode"] == "demo" else f"http://127.0.0.1:{resolved['api_port']}/")
            print("ENV hiệu lực:", "storage=" + resolved["backend"]["MAYSEC_STORAGE_MODE"],
                  "| metadata=" + resolved["backend"]["MAYSEC_METADATA_MODE"],
                  "| profile=" + (resolved["backend"]["AWS_PROFILE"] or "không dùng"))
            print("Xem đầy đủ giá trị và nguồn ENV tại mục 3 → 1.")
            if self.project.active:
                print("Chế độ đang chạy:", MODES[self.project.active["mode"]][0])
            print("Trạng thái:", ", ".join(f"{key}: {value}" for key, value in self.project.status().items()) or "Đã dừng")
            if self.project.active:
                if any(resolved[key] != self.project.active[key] for key in ("mode", "web_port", "api_port", "backend", "frontend")):
                    print("*** Cấu hình đã đổi — cần khởi động lại để áp dụng. ***")
            print("\n [1] Khởi động project")
            print(" [2] Chọn chế độ chạy")
            print(" [3] Xem / chỉnh cấu hình ENV")
            print(" [4] Kiểm tra môi trường / cài thư viện")
            print(" [5] Tài khoản AWS / Profile")
            print(" [6] Xem trạng thái / nhật ký / mở nhanh")
            print(" [7] Khởi động lại project")
            print(" [8] Dừng project")
            print(" [0] Thoát — dừng các dịch vụ do launcher mở")
            choice = ask("\nLựa chọn: ")
            if choice == "0":
                return
            if choice == "3":
                self.edit_config()
            elif choice == "4":
                self.environment_menu()
            elif choice == "5":
                self.aws_menu()
            elif choice == "6":
                self.running_menu()
            else:
                def action():
                    if choice == "1":
                        self.start()
                    elif choice == "2":
                        self.edit_mode()
                    elif choice == "7":
                        if not self.project.services:
                            raise RuntimeError("Project chưa chạy. Chọn Khởi động project.")
                        self.project.stop()
                        self.start()
                    elif choice == "8":
                        self.project.stop()
                        print("Đã dừng các tiến trình do launcher quản lý; dữ liệu đã lưu vẫn được giữ.")
                    else:
                        raise ValueError("Lựa chọn không hợp lệ.")
                attempt(action)


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="MaySec terminal launcher; mặc định mở menu.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="Kiểm tra môi trường, không cài đặt")
    group.add_argument("--show-config", action="store_true", help="Xem cấu hình hiệu lực, không chạy server")
    group.add_argument("--profiles", action="store_true", help="Liệt kê profile cục bộ, không xác thực AWS")
    args = parser.parse_args(argv)
    app = None
    try:
        app = Launcher()
        if args.check:
            checks = app.environment.inspect()
            for name, ok, detail in checks:
                print(f"[{'OK' if ok else 'CẦN KIỂM TRA'}] {name}: {detail}")
            return 0 if all(ok for name, ok, _ in checks if not name.startswith("AWS CLI")) else 1
        if args.show_config:
            app.show_config()
            return 0
        if args.profiles:
            profiles = app.aws.profiles()
            print(f"Có {len(profiles)} profile:")
            for name in profiles:
                print(name + " — " + app.aws.kind(name))
            print("Chưa gọi AWS để xác minh danh tính hoặc quyền.")
            return 0
        with InstanceLock(app.settings.runtime / "launcher.lock"):
            try:
                app.menu()
            finally:
                app.project.stop()
        return 0
    except (KeyboardInterrupt, EOFError):
        print("\nĐã thoát launcher; đang dọn tiến trình…")
        return 0
    except (ValueError, RuntimeError, OSError) as exc:
        print("LỖI:", redact(str(exc)))
        return 1
    finally:
        if app:
            app.project.stop()


if __name__ == "__main__":
    raise SystemExit(main())
