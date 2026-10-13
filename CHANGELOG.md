# Changelog

## 1.0.2 - 2026-10-14

### Fixed

- Replace stale pre-publication wording in the README, security policy, and
  contributing guide with the verified public repository and npm workflow.
- Avoid pinning the README status and primary install command to an obsolete
  patch release.

## 1.0.1 - 2026-10-10

### Added

- Ship the offline range-response fixtures in the npm tarball.
- Document the related S3 multipart-planning utility.

## 1.0.0 - 2026-10-06

Initial public release.

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
