> This document covers favorites and content. The complete current endpoint/lifecycle/activity contract is [api-contract.md](api-contract.md); installation is in [api-guide.md](api-guide.md).

# Phase 3: file preferences and content

The application still uses the development owner dependency (`dev-user`). Each
request looks up metadata using that owner and the path file ID. These endpoints
do not accept storage locations from the browser. The new explicit rescan route
starts a configured workflow; see [quota-scan.md](quota-scan.md) for current quota,
report and rescan contracts and deployment requirements.

## Capabilities

`GET /health` adds:

```json
{"capabilities":{"persistent_favorites":true,"file_content":true}}
```

Favorites require enabled, initialized DynamoDB metadata. Content additionally
requires the configured storage adapter to support reads. These flags describe
configured dependencies, not a live AWS/IAM connectivity probe.

Size limits use decimal units: 1 KB = 1,000 bytes, 1 MB = 1,000,000 bytes,
1 GB = 1,000,000,000 bytes. `POST /upload` accepts at most 100 MB per file,
including exactly 100,000,000 bytes. `MAYSEC_MAX_FILE_SIZE_BYTES` may lower the
limit; larger values (including the legacy 104,857,600 default) are capped at
100,000,000. `GET /health` reports this effective limit. Restart the backend to
apply the change. Multipart chunk sizes remain binary for the storage SDK.

## Favorites

`PATCH /files/{id}/preferences` accepts exactly:

```json
{"starred":true}
```

The boolean is strict: strings, integers, missing values and extra fields return
422. The response is `{id, starred, starred_updated_at}` with an ISO UTC timestamp.
The conditional DynamoDB update changes only `starred` and `starred_updated_at`;
it neither recreates missing records nor modifies upload/scan fields or
`updated_at`. An item deleted during the update returns 404. Backend failure
returns 503; clients should refresh/reconcile before assuming the write failed.

`GET /files` adds `starred` (default false) and `starred_updated_at` (default null)
to each existing record. Star timestamps are independent of scan timestamps.
The existing upload and status response contracts are unchanged.

## Content

`GET /files/{id}/content?mode=download` returns the complete file as an attachment.
The default mode is download. `mode=preview` returns inline content for:

| Content type | Maximum size |
| --- | --- |
| image/png, image/jpeg, image/gif, image/webp | 10 MB |
| application/pdf | 20 MB |
| text/plain, text/csv, application/json (valid UTF-8) | 1 MB |

The web client sends `Accept: application/x-ndjson` for both modes. After the same
ownership, scan, MIME, size and storage checks, the server responds with UTF-8
newline-delimited JSON rather than a browser attachment:

```json
{"kind":"metadata","id":"file-id","content_type":"application/pdf","size_bytes":5}
{"kind":"data","data":"aGVsbG8="}
{"kind":"end"}
```

The metadata MIME is the preview MIME or `application/octet-stream` for downloads.
Each data record encodes at most 49,152 original bytes as base64. A full-size
record has 65,536 base64 characters; the final record may be smaller. Framing
avoids building a whole-file base64 string, but adds approximately 33% to the
network payload. The original-byte limits above still apply. This response has
`Content-Type: application/x-ndjson`, `Vary: Accept`, `Cache-Control: no-store`
and `X-Content-Type-Options: nosniff`, with no `Content-Disposition` or filename.
It reduces download-manager interception of the API request; extension behavior
still depends on the user's browser setup. The raw endpoint remains available
when the NDJSON representation is not requested.

The client validates identity, MIME, declared/actual byte counts, frame sizes,
base64 and the end record, and cancels incomplete/invalid/oversize streams. It
reconstructs a local Blob for preview or saving. On supported secure desktop
browsers, downloading calls `showSaveFilePicker` in the click handler before any
network await, then writes and closes the selected file. Picker cancellation
does not fetch content; failed/aborted writes are aborted without closing. Other
browsers retain the Blob download fallback. Restart the backend to enable the
new representation; an older backend may still return raw content.

When metadata has only a generic `application/octet-stream` (or blank) MIME,
`.txt`, `.csv` and `.json` filenames may select their text MIME above, still with
strict UTF-8 validation and the 1 MB limit. Explicit MIME types such as HTML/SVG
are never overridden by the filename. HTML, SVG and other types are not available for inline preview. Downloads are
limited to 100 MB and use `application/octet-stream`. Preview types are selected
from the validated metadata MIME allowlist; this endpoint does not inspect or
convert image/PDF contents.

Both operations require `upload_state=uploaded` and `scan_status=safe`. The API
validates the owned metadata record, requires its original
`uploads/{owner}/{id}/{filename}` key, and requires the configured provider and S3
bucket to match. Quarantine keys, directory traversal, alternate buckets and
client-supplied locations are not used. A configured local adapter enforces its
resolved directory boundary. S3 reads use the configured server client and bucket.

Reads are buffered with a fixed upper bound, checking both reported length and
actual bytes, and close the provider body/file before returning the response.
An actual length different from metadata returns 502. Raw content responses set
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, a safe ASCII filename
fallback and UTF-8 `filename*` in `Content-Disposition`. No credentials, bucket
names, paths or raw SDK errors are returned.

| Status | Meaning |
| --- | --- |
| 400 | Invalid file ID |
| 404 | Owned metadata or stored content not found |
| 409 | Upload incomplete or scan is not safe |
| 413 | Metadata or actual content exceeds the operation's limit |
| 415 | Unsupported preview type or invalid UTF-8 text |
| 422 | Invalid mode or request body |
| 502 | Storage failure or content length mismatch |
| 503 | Metadata/storage unavailable or invalid stored metadata/location |

CORS permits PATCH and exposes `Content-Type`, `Content-Length` and
`Content-Disposition`, in addition to the upload recovery headers.

## Verification

From `backend`, run `.\.venv\Scripts\python.exe -m pytest -q
tests/test_phase3_files.py`. The tests exercise real FastAPI routes with fake
low-level DynamoDB/S3 clients and real temporary local files. AWS client creation
is forbidden in these tests. Existing backend tests are preserved.
