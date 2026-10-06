import assert from 'node:assert/strict';
import { auditResumeResponse } from '../dist/index.mjs';

// Offline fixture. A real downloader must bind saved state to the same final
// resource/representation and stage bounded response bytes before committing.
const input = {
  stored: { bytes: 0, etag: '"asset-v1"', identityEncoded: true },
  request: { method: 'GET', range: 'bytes=0-3', ifRange: '"asset-v1"' },
  response: { status: 206, headersComplete: true, contentRange: 'bytes 0-3/10', etag: '"asset-v1"' },
};
assert.equal(auditResumeResponse(input).action, 'await-body');
const verified = auditResumeResponse({ ...input, body: { bytes: 4, complete: true } });
assert.equal(verified.action, 'append');
assert.equal(verified.nextOffset, 4);
assert.equal(verified.reachesEnd, false);
assert.equal(auditResumeResponse({ ...input, response: { ...input.response, status: 200 } }).action, 'restart');
console.log('Offline fixtures passed: staged 206, zero offset, and 200 restart.');
