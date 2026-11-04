"""Explicit, passwordless presentation mode. Disabled by default.

Tokens are application demo sessions, NOT Cognito access tokens. Identity and
role always come from the configured User Pool; arbitrary client roles are ignored.
"""
import logging
import secrets
import threading
import time
from uuid import UUID

import jwt
from botocore.exceptions import BotoCoreError, ClientError

from .cognito_auth import AuthError, AuthUser

logger = logging.getLogger(__name__)
DEMO_TYPE = "maysec-demo+jwt"


class DemoAccounts:
    def __init__(self, client, pool_id, *, signing_key="", clock=time.time):
        self.client, self.pool_id, self.clock = client, pool_id, clock
        self.key = signing_key or secrets.token_urlsafe(48)
        self.issuer = f"maysec-demo:{pool_id}"
        self._lock = threading.Lock()
        self._items, self._until = [], 0

    def accounts(self, *, fresh=False):
        with self._lock:
            if not fresh and self.clock() < self._until:
                return [dict(item) for item in self._items]
            try:
                users = self._pages("list_users", "Users", "PaginationToken", UserPoolId=self.pool_id)
                roles = {}
                for group in ("user", "admin"):
                    for user in self._pages("list_users_in_group", "Users", "NextToken",
                                            UserPoolId=self.pool_id, GroupName=group):
                        roles[user["Username"]] = group
                items = []
                for user in users:
                    attrs = {a["Name"]: a["Value"] for a in user.get("Attributes", [])}
                    try:
                        sub = str(UUID(attrs.get("sub", "")))
                    except ValueError:
                        continue
                    username = user["Username"]
                    role = roles.get(username)
                    status = user.get("UserStatus", "")
                    active = user.get("Enabled", False) and bool(role) and status in {"CONFIRMED", "FORCE_CHANGE_PASSWORD", "EXTERNAL_PROVIDER"}
                    items.append({"id": sub, "username": username,
                                  "name": attrs.get("name") or attrs.get("preferred_username") or attrs.get("email") or username,
                                  "email": attrs.get("email", ""),
                                  "role": role, "active": active, "status": status})
                items.sort(key=lambda item: (item["role"] == "admin", item["name"].casefold(), item["id"]))
            except (ClientError, BotoCoreError) as exc:
                code = exc.response.get("Error", {}).get("Code", "ClientError") if isinstance(exc, ClientError) else type(exc).__name__
                logger.warning("Cognito demo directory unavailable (%s)", code)
                raise AuthError(503, "Chưa đọc được danh sách Cognito. Kiểm tra quyền ListUsers và ListUsersInGroup của backend.") from None
            self._items, self._until = items, self.clock() + 15
            return [dict(item) for item in items]

    def _pages(self, method, field, token_field, **kwargs):
        records, seen = [], set()
        while True:
            result = getattr(self.client, method)(**kwargs, Limit=60)
            records.extend(result.get(field, []))
            token = result.get(token_field)
            if not token:
                return records
            if token in seen or len(records) > 10000:
                raise AuthError(503, "Danh sách Cognito quá lớn hoặc phân trang không hợp lệ")
            seen.add(token)
            kwargs[token_field] = token

    def account(self, owner_id, *, fresh=False):
        account = next((a for a in self.accounts(fresh=fresh) if a["id"] == owner_id), None)
        if not account or not account["active"]:
            raise AuthError(403, "Tài khoản đã tắt hoặc chưa được gán nhóm user/admin")
        return account

    def login(self, owner_id):
        account = self.account(owner_id, fresh=True)
        now = int(self.clock())
        token = jwt.encode({"iss": self.issuer, "aud": "maysec-demo", "sub": account["id"],
                            "iat": now, "exp": now + 3600, "jti": secrets.token_urlsafe(16)},
                           self.key, algorithm="HS256", headers={"typ": DEMO_TYPE})
        return {"access_token": token, "token_type": "Bearer", "expires_in": 3600, "user": account}

    def verify(self, token):
        try:
            claims = jwt.decode(token, self.key, algorithms=["HS256"], issuer=self.issuer,
                                audience="maysec-demo", options={"require": ["exp", "iat", "sub", "iss", "aud", "jti"]})
            owner_id = str(UUID(claims["sub"]))
        except (jwt.PyJWTError, ValueError, TypeError):
            raise AuthError(401, "Phiên demo không hợp lệ hoặc đã hết hạn — chọn lại tài khoản") from None
        account = self.account(owner_id)
        return AuthUser(owner_id=owner_id, role=account["role"], username=account["username"])


def is_demo_token(token):
    try:
        return jwt.get_unverified_header(token).get("typ") == DEMO_TYPE
    except jwt.PyJWTError:
        return False
