# Phase 3: file preferences and content

The application still uses the development owner dependency (`dev-user`). Each
request looks up metadata using that owner and the path file ID. These endpoints
do not accept storage locations from the browser and do not start a scan.

## Capabilities

`GET /health` adds:

```json
{"capabilities":{"persistent_favorites":true,"file_content":true}}
```

Favorites require enabled, initialized DynamoDB metadata. Content additionally
requires the configured storage adapter to support reads. These flags describe
configured dependencies, not a live AWS/IAM connectivity probe.

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
| image/png, image/jpeg, image/gif, image/webp | 10 MiB |
| application/pdf | 20 MiB |
| text/plain, text/csv, application/json (valid UTF-8) | 1 MiB |

When metadata has only a generic `application/octet-stream` (or blank) MIME,
`.txt`, `.csv` and `.json` filenames may select their text MIME above, still with
strict UTF-8 validation and the 1 MiB limit. Explicit MIME types such as HTML/SVG
are never overridden by the filename. HTML, SVG and other types are not available for inline preview. Downloads are
limited to 100 MiB and use `application/octet-stream`. Preview types are selected
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
An actual length different from metadata returns 502. All content responses set
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
