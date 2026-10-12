"""Bound multipart ingress, including clients which omit Content-Length."""

from starlette.formparsers import MultiPartException
from starlette.responses import JSONResponse

MULTIPART_ALLOWANCE = 1024 * 1024


class UploadBodyLimitMiddleware:
    def __init__(self, app, max_file_size_bytes: int):
        self.app = app
        self.limit = max_file_size_bytes + MULTIPART_ALLOWANCE

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/upload":
            await self.app(scope, receive, send)
            return
        response = JSONResponse(status_code=413, content={
            "detail": "Nội dung request vượt giới hạn upload (gồm phần multipart)"
        })
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    if int(value) > self.limit:
                        await response(scope, receive, send)
                        return
                except ValueError:
                    pass  # Actual bytes are still counted below.
        received = 0
        exceeded = False

        async def limited_receive():
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.limit:
                    exceeded = True
                    # Starlette closes the multipart parser's temporary files
                    # for this exception. FastAPI turns it into a 400; replace
                    # that response with 413 after it finishes unwinding.
                    raise MultiPartException("Upload request body too large")
            return message

        async def limited_send(message):
            if not exceeded:
                await send(message)

        await self.app(scope, limited_receive, limited_send)
        if exceeded:
            await response(scope, receive, send)
