import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUploadResponse, validateApiBaseUrl } from '../src/api/client.js';

test('local and S3 labels survive response parsing; unintegrated scan stays explicit', () => {
  for (const storage of ['local', 's3']) {
    assert.deepEqual(parseUploadResponse(JSON.stringify({ id: 'id', key: 'key', storage, scan_status: 'not_started' })), {
      id: 'id', key: 'key', storage, scanStatus: 'not_started',
    });
  }
});

test('legacy id/key aliases are accepted without claiming a storage provider', () => {
  assert.equal(parseUploadResponse('{"file":{"file_id":"old","s3_key":"old-key"}}').storage, 'unspecified');
  assert.equal(parseUploadResponse('{"key":"old-key"}').key, 'old-key');
  assert.equal(parseUploadResponse('{"key":"old-key"}').scanStatus, 'unknown');
});

test('malformed, failed, unconfirmed or unknown-provider responses never succeed', () => {
  for (const text of ['<html>bad</html>', '[]', '{}', '{"success":false,"id":"id"}', '{"error":"denied","id":"id"}', '{"id":"id","storage":"mock"}']) {
    assert.throws(() => parseUploadResponse(text));
  }
});

test('API address must be HTTP(S), without credentials or mixed content', () => {
  assert.equal(validateApiBaseUrl(' http://localhost:8000/ ', 'http:'), 'http://localhost:8000');
  for (const value of ['file:///tmp', 'http://user:secret@localhost', 'http://localhost?x=1']) {
    assert.throws(() => validateApiBaseUrl(value, 'http:'));
  }
  assert.throws(() => validateApiBaseUrl('http://localhost:8000', 'https:'));
});
