import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { auditResumeResponse as audit } from '../dist/index.mjs';

function fixture() {
  return {
    stored: { bytes: 10, etag: '"v1"', totalBytes: 20, identityEncoded: true },
    request: { method: 'GET', range: 'bytes=10-', ifRange: '"v1"' },
    response: { status: 206, headersComplete: true, contentRange: 'bytes 10-19/20', contentLength: '10', etag: '"v1"' },
    body: { bytes: 10, complete: true },
  };
}
function expectCode(input, code, action = 'reject') {
  const result = audit(input);
  assert.equal(result.action, action, JSON.stringify(result));
  assert.equal(result.code, code);
  return result;
}

test('append needs coherent metadata and final body evidence', () => {
  const result = audit(fixture());
  assert.deepEqual({ ...result, message: '' }, { action: 'append', code: 'append_eligible', message: '', range: { start: 10, end: 19, total: 20 }, bodyBytes: 10, nextOffset: 20, reachesEnd: true });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.range));
});

test('header-only evidence never appends', () => {
  const input = fixture(); delete input.body;
  const result = expectCode(input, 'body_required', 'await-body');
  assert.equal(result.expectedBodyBytes, 10);
  assert.equal('nextOffset' in result, false);
});

test('bounded intermediate segments and clamped ends remain eligible', () => {
  const input = fixture(); input.request.range = 'bytes=10-99';
  assert.equal(audit(input).action, 'append');
  input.response.contentRange = 'bytes 10-14/20'; input.response.contentLength = '5'; input.body.bytes = 5;
  assert.equal(audit(input).reachesEnd, false);
  assert.equal(audit(input).nextOffset, 15);
});

test('zero-offset and one-byte segments work', () => {
  const input = fixture();
  input.stored.bytes = 0; input.stored.totalBytes = 1; input.request.range = 'bytes=0-0';
  input.response.contentRange = 'bytes 0-0/1'; input.response.contentLength = '1'; input.body.bytes = 1;
  assert.equal(audit(input).action, 'append');
  assert.equal(audit(input).nextOffset, 1);
});

test('optional totals and lengths do not invent completion', () => {
  const input = fixture(); delete input.stored.totalBytes; delete input.response.contentLength;
  input.response.contentRange = 'bytes 10-19/*';
  const result = audit(input);
  assert.equal(result.action, 'append'); assert.equal(result.range.total, null); assert.equal(result.reachesEnd, false);
  input.stored.totalBytes = 20;
  assert.equal(audit(input).reachesEnd, true);
});

test('unknown response total still obeys saved total', () => {
  const input = fixture(); input.response.contentRange = 'bytes 10-20/*'; input.response.contentLength = '11'; input.body.bytes = 11;
  expectCode(input, 'total_mismatch');
});

test('known response total must match saved total', () => {
  const input = fixture(); input.response.contentRange = 'bytes 10-19/21'; expectCode(input, 'total_mismatch');
});

test('200 always restarts rather than appending or certifying its body', () => {
  for (const bytes of [0, 10, 999]) {
    const input = fixture(); input.response.status = 200; input.body.bytes = bytes;
    input.response.contentRange = 'bytes 10-19/20';
    const result = expectCode(input, 'full_response', 'restart');
    assert.equal('nextOffset' in result, false);
  }
});

test('416 revalidates regardless of equal, shorter, longer, or zero length', () => {
  for (const total of [0, 9, 10, 11, 20]) {
    const input = fixture(); input.response.status = 416; input.response.contentRange = `bytes */${total}`;
    const result = expectCode(input, 'range_unsatisfied', 'revalidate');
    assert.equal(result.totalBytes, total); assert.equal('reachesEnd' in result, false);
  }
});

test('416 requires supported unsatisfied Content-Range evidence', () => {
  for (const value of [undefined, 'bytes 0-9/10', 'bytes */*', 'bytes */-1', 'bytes */9007199254740992']) {
    const input = fixture(); input.response.status = 416; input.response.contentRange = value;
    expectCode(input, 'invalid_content_range');
  }
});

test('unsupported statuses and methods reject', () => {
  for (const status of [0, 201, 204, 301, 304, 403, 500, '206', NaN]) {
    const input = fixture(); input.response.status = status; expectCode(input, 'unsupported_status');
  }
  for (const method of ['HEAD', 'POST', 'get', undefined]) {
    const input = fixture(); input.request.method = method; expectCode(input, 'unsupported_method');
  }
});

test('caller assertions are required and fail closed', () => {
  for (const value of [false, undefined, 1, 'true', null]) {
    let input = fixture(); input.stored.identityEncoded = value; expectCode(input, 'identity_not_confirmed');
    input = fixture(); input.response.headersComplete = value; expectCode(input, 'headers_incomplete');
  }
});

test('only strong stored and returned ETags match', () => {
  for (const value of [undefined, null, '', 'v1', 'W/"v1"', '"v2"', '"v1", "v1"', '"a b"', '"💾"']) {
    const input = fixture(); input.response.etag = value; expectCode(input, 'response_etag_mismatch');
  }
  for (const value of [undefined, '', 'W/"v1"', 'v1']) {
    const input = fixture(); input.stored.etag = value; expectCode(input, 'invalid_stored_etag');
  }
});

test('empty quoted, comma, backslash and obs-text tags are opaque valid tags', () => {
  for (const value of ['""', '"a,b"', '"a\\b"', '"\u00ff"']) {
    const input = fixture(); input.stored.etag = value; input.request.ifRange = value; input.response.etag = value;
    assert.equal(audit(input).action, 'append', value);
  }
});

test('optional If-Range is checked, and does not replace response validation', () => {
  const input = fixture(); delete input.request.ifRange;
  assert.equal(audit(input).action, 'append');
  for (const value of ['W/"v1"', '"v2"', 'Wed, 21 Oct 2015 07:28:00 GMT', '']) {
    input.request.ifRange = value; expectCode(input, 'if_range_mismatch');
  }
  input.request.ifRange = '"v1"'; delete input.response.etag;
  expectCode(input, 'response_etag_mismatch');
});

test('encoded and multipart responses are outside policy', () => {
  for (const value of ['gzip', 'br', 'identity, identity', '', 'deflate']) {
    const input = fixture(); input.response.contentEncoding = value; expectCode(input, 'unsupported_encoding');
  }
  for (const value of ['multipart/byteranges; boundary=x', 'MULTIPART/mixed']) {
    const input = fixture(); input.response.contentType = value; expectCode(input, 'unsupported_multipart');
  }
  const input = fixture(); input.response.contentEncoding = 'IDENTITY'; input.response.contentType = 'application/octet-stream';
  assert.equal(audit(input).action, 'append');
});

test('request range syntax excludes suffixes, multiple ranges, and unsafe values', () => {
  for (const value of [undefined, '', 'bytes=-10', 'bytes=10-19,20-29', 'items=10-', 'bytes=10-9', 'bytes=10.5-', 'bytes=1e1-', 'bytes=10-9007199254740992', 'bytes=9007199254740992-', 'bytes=10- 19']) {
    const input = fixture(); input.request.range = value; expectCode(input, 'invalid_request_range');
  }
});

test('Content-Type ambiguity is conservatively rejected without splitting ETags', () => {
  for (const value of ['text/plain, multipart/byteranges', 'text/plain; x="a,b"', 'text/plain, text/plain', '', 'text', 'text /plain']) {
    const input = fixture(); input.response.contentType = value; expectCode(input, 'unsupported_content_type');
  }
  const input = fixture(); input.response.contentType = 'text/plain; charset=utf-8';
  assert.equal(audit(input).action, 'append');
});

test('gaps, overlaps and oversized responses are rejected', () => {
  const input = fixture(); input.request.range = 'bytes=9-'; expectCode(input, 'request_offset_mismatch');
  input.request.range = 'bytes=10-'; input.response.contentRange = 'bytes 9-18/20'; expectCode(input, 'response_offset_mismatch');
  input.response.contentRange = 'bytes 11-19/20'; expectCode(input, 'response_offset_mismatch');
  input.response.contentRange = 'bytes 10-19/20'; input.request.range = 'bytes=10-18'; expectCode(input, 'response_end_exceeds_request');
});

test('malformed, duplicate, impossible Content-Range values reject', () => {
  for (const value of [undefined, '', 'bytes */20', 'bytes 19-10/20', 'bytes 10-20/20', 'bytes 10-19/0', 'bytes 10-19/19', 'bytes 10-19/20, bytes 10-19/20', 'bytes 10-19/9007199254740992', 'bytes 10-9007199254740991/*', 'bytes 10-19 /20', 'items 10-19/20']) {
    const input = fixture(); input.response.contentRange = value; expectCode(input, 'invalid_content_range');
  }
});

test('Content-Length is optional but must be a single matching decimal count', () => {
  for (const value of ['9', '11', '10,10', '-10', '1e1', '10.0', '', '9007199254740992']) {
    const input = fixture(); input.response.contentLength = value; expectCode(input, 'content_length_mismatch');
  }
  const input = fixture(); input.response.contentLength = '00010'; assert.equal(audit(input).action, 'append');
  input.response.contentLength = null; assert.equal(audit(input).action, 'append');
});

test('body counts require clean EOF and exact length', () => {
  const input = fixture(); input.body.complete = false; expectCode(input, 'body_incomplete');
  input.body.complete = true;
  for (const value of [0, 9, 11]) { input.body.bytes = value; expectCode(input, 'body_length_mismatch'); }
  for (const value of [undefined, null, '10', NaN, Infinity, -1, 1.5, 9007199254740992]) { input.body.bytes = value; expectCode(input, 'invalid_input'); }
  input.body.bytes = 10;
  for (const value of [undefined, 1, 'true', null]) { input.body.complete = value; expectCode(input, 'invalid_input'); }
});

test('all numeric stored evidence is bounded and coherent', () => {
  for (const value of [-1, 0.5, NaN, Infinity, '10', undefined, null, 9007199254740992]) {
    const input = fixture(); input.stored.bytes = value; expectCode(input, 'invalid_input');
  }
  for (const value of [9, -1, 0.5, NaN, Infinity, '20', null, 9007199254740992]) {
    const input = fixture(); input.stored.totalBytes = value; expectCode(input, 'invalid_input');
  }
});

test('max-safe final offset is accepted without precision loss', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const input = fixture(); input.stored.bytes = max - 1; input.stored.totalBytes = max;
  input.request.range = `bytes=${max - 1}-`; input.response.contentRange = `bytes ${max - 1}-${max - 1}/${max}`;
  input.response.contentLength = '1'; input.body.bytes = 1;
  assert.equal(audit(input).nextOffset, max);
});

test('headers reject arrays, controls, overly long values, and CRLF before trimming', () => {
  for (const value of [['bytes 10-19/20'], 10, {}, 'bytes 10-19/20\r\n', '\nbytes 10-19/20', '\x00', 'x'.repeat(8193)]) {
    const input = fixture(); input.response.contentRange = value; expectCode(input, 'invalid_header');
  }
  const input = fixture(); input.request.range = '\tBYTES=0010-\t'; input.response.contentRange = ' \tBYTES 0010-0019/0020\t ';
  assert.equal(audit(input).action, 'append');
});

test('shape failures and throwing accessors yield controlled rejection', () => {
  for (const value of [null, undefined, [], 1, 'bad', {}, { stored: null }, { stored: {}, request: [] }]) expectCode(value, 'invalid_input');
  for (const path of ['stored', 'request', 'response', 'body']) {
    const input = fixture(); Object.defineProperty(input, path, { get() { throw new Error('private detail'); } });
    const result = expectCode(input, 'invalid_input'); assert.equal(result.message.includes('private detail'), false);
  }
  const input = fixture(); input.body = [];
  expectCode(input, 'invalid_input');
});

test('even hostile thrown values cannot escape the rejection boundary', () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('must not inspect thrown value'); } });
  for (const value of [proxy, hostile, null, undefined, false, 0, 'error', Symbol('error')]) {
    const input = fixture();
    Object.defineProperty(input, 'stored', { get() { throw value; } });
    expectCode(input, 'invalid_input');
  }
  expectCode(proxy, 'invalid_input');
});

test('bounded long whitespace runs are handled without changing evidence', () => {
  const input = fixture();
  const value = 'x' + ' '.repeat(8190) + 'x';
  for (const name of ['contentRange', 'contentLength', 'etag', 'contentEncoding', 'contentType']) input.response[name] = value;
  expectCode(input, 'unsupported_encoding');
  input.request.range = ' '.repeat(8192); expectCode(input, 'invalid_request_range');
});

test('inputs are immutable and decisions deterministic', () => {
  const input = fixture(); const original = structuredClone(input);
  Object.values(input).forEach(Object.freeze); Object.freeze(input);
  assert.deepEqual(audit(input), audit(input)); assert.deepEqual(input, original);
});

test('each user-supplied property is read at most once', () => {
  const input = fixture(); let count = 0;
  Object.defineProperty(input.response, 'etag', { get() { count += 1; return count === 1 ? '"v1"' : '"changed"'; } });
  assert.equal(audit(input).action, 'append'); assert.equal(count, 1);
});

test('deterministic range sweep enforces the append invariants', () => {
  for (let start = 0; start < 25; start += 1) {
    for (let length = 1; length < 12; length += 1) {
      const total = start + length;
      const input = fixture(); input.stored.bytes = start; input.stored.totalBytes = total;
      input.request.range = `bytes=${start}-`; input.response.contentRange = `bytes ${start}-${total - 1}/${total}`;
      input.response.contentLength = String(length); input.body.bytes = length;
      const result = audit(input);
      assert.equal(result.action, 'append'); assert.equal(result.nextOffset, total); assert.equal(result.bodyBytes, length);
      input.body.bytes += 1; assert.notEqual(audit(input).action, 'append');
      input.response.status = 200; assert.notEqual(audit(input).action, 'append');
      input.response.status = 416; input.response.contentRange = `bytes */${total}`; assert.equal(audit(input).action, 'revalidate');
    }
  }
});

test('CommonJS and ESM export the same function', () => {
  const require = createRequire(import.meta.url);
  assert.equal(require('../dist/index.js').auditResumeResponse, audit);
});
