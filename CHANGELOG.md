# Changelog

## 1.0.0 (unreleased candidate)

Registry publication has not been confirmed. This section describes the initial candidate, not a published release.

### Added

- Original synchronous `auditResumeResponse` API for one GET range resuming a contiguous identity-coded prefix.
- Correlation of stored offsets and strong ETags with actual request headers, response metadata, and caller-observed completed body length.
- `await-body`, `append`, `restart`, `revalidate`, and `reject` decisions with diagnostic codes.
- Explicit assertions for stored byte provenance and complete relevant response headers.
- Bounded and open-ended requests, zero offsets, optional Content-Length, and unknown complete lengths.
- Safe-integer and header-input limits, frozen result objects, and input-access error handling.
- CommonJS and ESM builds with TypeScript declarations and no runtime dependencies.
- Local tests and fixture example, a Node.js 22/24 CI definition, and integration and security guidance.

### Scope

No downloader, I/O, retries, checksums, multipart assembly, automatic file changes, or guarantee of integrity. A `200` never permits append; a `416` never proves completeness.
