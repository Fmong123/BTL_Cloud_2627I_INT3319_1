"""Shared target scope for administrative account and file operations."""
from fastapi import HTTPException


def require_user_account(item):
    if item.get("role") != "user":
        raise HTTPException(403, "Chỉ được xem và quản lý tài khoản người dùng; tài khoản quản trị nằm ngoài phạm vi này")


def user_scope(items):
    return {ident: item for ident, item in items.items() if item.get("role") == "user"}


def user_account(items, ident):
    item = items.get(ident)
    if item is None:
        raise HTTPException(404, "Không tìm thấy tài khoản trong hệ thống")
    require_user_account(item)
    return item
