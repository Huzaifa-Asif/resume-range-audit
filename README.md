# resume-range-audit

Explain whether a single HTTP resume response is eligible to append to a saved file prefix.

`auditResumeResponse` correlates the saved offset and strong ETag, the actual GET request, response headers, and an optional observed body count. It returns one of five decisions with a machine-readable diagnostic. It performs no network or file I/O, retries, checksums, or storage changes. There are no runtime dependencies.

**Status:** Published on [npm](https://www.npmjs.com/package/resume-range-audit), with source available in the public [`Huzaifa-Asif/resume-range-audit`](https://github.com/Huzaifa-Asif/resume-range-audit) repository. See the [changelog](CHANGELOG.md) for release history.

## Before you use it

This is a deliberately narrow policy for resuming **one contiguous prefix of an identity-coded representation with one GET byte range**.

- Your application must bind the saved state, actual request, final resource after redirects, and selected representation to each other. A strong ETag is an opaque validator in that context; do not treat it as a globally unique identifier or proof of checksum integrity.
- `stored.identityEncoded: true` and `response.headersComplete: true` are assertions made by your application. The library cannot establish them for you. Never set them simply to make an audit pass.
- Count raw, untransformed identity-coded payload bytes, excluding HTTP transfer framing. Require a clean end of the response body. A stream error, cancellation, or truncated connection is not clean EOF.
- `append` means eligible under the supplied evidence. It does not verify payload integrity, server honesty, the existing file, or a successful disk write.
- A `200` is never appended. A `416` never establishes completeness. `reachesEnd` describes range arithmetic only.

## Installation

Node.js 22 or later is the supported runtime. CommonJS, ESM, and TypeScript declarations are included in the built package.

Install the published package from npm:

```sh
npm install resume-range-audit
```

### Validate a source checkout locally

From the supplied source directory:

```sh
npm ci
npm run check
npm pack
```

Then, from a separate application directory, install the generated tarball using its actual path:

```sh
npm install /absolute/path/to/resume-range-audit-1.0.2.tgz
```

## Quickstart

This fixture makes no HTTP request and writes no file. Its caller assertions stand for conditions the application has already established.

```js
import { auditResumeResponse } from 'resume-range-audit';

const evidence = {
  stored: {
    bytes: 4,
    etag: '"asset-v1"',
    totalBytes: 10,
    identityEncoded: true,
  },
  request: {
    method: 'GET',
    range: 'bytes=4-9',
    ifRange: '"asset-v1"',
  },
  response: {
    status: 206,
    headersComplete: true,
    contentRange: 'bytes 4-9/10',
    contentLength: '6',
    etag: '"asset-v1"',
    // Absent Content-Encoding is known to be genuinely absent here.
    contentEncoding: null,
    contentType: 'application/octet-stream',
  },
};

const beforeBody = auditResumeResponse(evidence);
console.log(beforeBody.action); // 'await-body'
if (beforeBody.action === 'await-body') {
  console.log(beforeBody.expectedBodyBytes); // 6
}

// In real code, stage and count the body before supplying this evidence.
const afterBody = auditResumeResponse({
  ...evidence,
  body: { bytes: 6, complete: true },
});

if (afterBody.action === 'append') {
  console.log(afterBody.nextOffset); // 10
  console.log(afterBody.reachesEnd); // true: range arithmetic, not integrity
  // Your application may now consider committing the staged segment.
}

const fallback = auditResumeResponse({
  ...evidence,
  response: { status: 200, headersComplete: true },
});
console.log(fallback.action); // 'restart'; never append a full response

const unsatisfied = auditResumeResponse({
  ...evidence,
  response: {
    status: 416,
    headersComplete: true,
    contentRange: 'bytes */10',
  },
});
console.log(unsatisfied.action); // 'revalidate'; not proof of completion
```

CommonJS:

```js
const { auditResumeResponse } = require('resume-range-audit');
```

TypeScript exports:

```ts
import {
  auditResumeResponse,
  type AuditInput,
  type AuditResult,
  type ByteRange,
  type RejectCode,
} from 'resume-range-audit';
```

When building a separately declared TypeScript evidence object, use `satisfies AuditInput` to retain the literal `'GET'` method type.

## API reference

### `auditResumeResponse(input: AuditInput): AuditResult`

A synchronous, stateless function. It does not mutate the input. Results and their returned `range` objects are frozen. Invalid evidence produces a `reject` result instead of a validation exception; property-access exceptions are also caught. Pass ordinary data objects, not getters or proxies with side effects.

### Input

```ts
interface AuditInput {
  readonly stored: {
    readonly bytes: number;
    readonly etag: string;
    readonly totalBytes?: number;
    readonly identityEncoded: boolean;
  };
  readonly request: {
    readonly method: 'GET';
    readonly range: string;
    readonly ifRange?: string | null;
  };
  readonly response: {
    readonly status: number;
    readonly headersComplete: boolean;
    readonly contentRange?: string | null;
    readonly contentLength?: string | null;
    readonly etag?: string | null;
    readonly contentEncoding?: string | null;
    readonly contentType?: string | null;
  };
  readonly body?: {
    readonly bytes: number;
    readonly complete: boolean;
  };
}
```

| Field | Contract |
| --- | --- |
| `stored.bytes` | Length of the existing contiguous prefix, and therefore the next requested byte offset. Zero is supported. |
| `stored.etag` | Stored strong entity tag including its double quotes, for example `'"asset-v1"'`. Weak tags and dates are unsupported. |
| `stored.totalBytes` | Optional known complete length. Must be at least `stored.bytes`. Omit when unknown; `null` is not supported for this numeric field. |
| `stored.identityEncoded` | Must be exactly `true`, asserting that the saved prefix is untransformed identity-coded representation bytes. |
| `request.method` | Must be exactly `'GET'`, describing the request actually sent. |
| `request.range` | Exactly one `bytes=start-end` or `bytes=start-` range. Its start must equal `stored.bytes`; a supplied end must be at least the start. |
| `request.ifRange` | Optional actual `If-Range` value. When present, must be a strong ETag equal to `stored.etag`. It is not required. |
| `response.status` | A `206` can proceed to body auditing; a `200` requests a restart; a `416` requests revalidation. Other statuses are rejected. |
| `response.headersComplete` | Must be exactly `true`, asserting that relevant response headers are visible and faithfully represented, with none filtered or discarded. |
| `response.contentRange` | For `206`, `bytes start-end/total` or `bytes start-end/*`. For `416`, `bytes */total`. Required for those statuses. |
| `response.contentLength` | Optional decimal string. On `206`, must equal `end - start + 1` if present. |
| `response.etag` | On `206`, required to be a strong ETag equal to the stored tag. |
| `response.contentEncoding` | On `206`, must be genuinely absent or the token `identity` (case-insensitive). Other values are outside this policy. |
| `response.contentType` | On `206`, a supplied value must have one `type/subtype`, optionally followed by parameters. Any comma or `multipart/` type is rejected. This is a conservative check, not full media-type validation. |
| `body.bytes` | Observed identity-coded body payload byte count for this response only. Do not supply the expected size or cumulative file size. |
| `body.complete` | `true` only after clean EOF. A supplied `false` rejects the response. Omit the entire `body` object while verification is pending. |

All numeric counts and parsed decimal bounds must be non-negative safe integers. The response end must also permit a safe `end + 1`. Numeric strings are accepted only in header fields. Decimal headers may have leading zeroes; signs, fractions, exponents, and lists are unsupported.

Each supplied header must be one string of at most **8,192 UTF-16 code units (`string.length`) before trimming**. Optional header values may be omitted, `undefined`, or `null`; an empty string is not treated as absence. Only leading/trailing spaces and horizontal tabs are stripped. CR, LF, DEL, and other ASCII controls except horizontal tab are rejected. The byte-range unit is case-insensitive; internal syntax is deliberately strict. ETags retain their exact opaque value, including permitted commas and backslashes, after surrounding whitespace is removed.

Do not split entity tags on commas or silently pick one duplicate header. If your client has discarded relevant duplicates, this API cannot recover that information. Header-length limits bound parsing here; your HTTP client must enforce its own header, body, time, and connection limits.

### Results

Every result has `action`, `code`, and a human-readable `message`. Branch on `action` and `code`, not message wording. One diagnostic is returned; it is not a list of every problem.

| Action | Code | Additional fields | Meaning |
| --- | --- | --- | --- |
| `await-body` | `body_required` | `range`, `expectedBodyBytes` | Supported `206` metadata passes; the completed-body evidence has not been supplied. |
| `append` | `append_eligible` | `range`, `bodyBytes`, `nextOffset`, `reachesEnd` | Metadata and supplied clean-EOF count meet the policy. The caller still owns the commit and integrity checks. |
| `restart` | `full_response` | None | A full `200` response must not be appended to the saved prefix. |
| `revalidate` | `range_unsatisfied` | `totalBytes` | A syntactically supported `416` reports the server's length. Revalidate saved state separately. |
| `reject` | A `RejectCode` below | None | Required evidence is missing, inconsistent, malformed, or outside the supported policy. |

```ts
interface ByteRange {
  readonly start: number;
  readonly end: number; // Inclusive.
  readonly total: number | null;
}
```

`range.total` uses the response's known total, falling back to the known stored total. If neither is known it is `null`, and `reachesEnd` is `false`. When both totals are known they must agree. A bounded request or a shorter coherent response segment can yield `append` without reaching the end. `nextOffset` is `range.end + 1`.

The general input, caller assertions, scalar-header checks, request range, stored ETag, and any `If-Range` are checked before status-specific decisions. Consequently, an invalid evidence object for a `200` or `416` can return `reject`. Neither status ever returns `append`. Only the `206` path checks response ETag equality, response encoding, range coherence, and body evidence.

### Rejection codes

| Code | What to check |
| --- | --- |
| `invalid_input` | Object structure, numeric counts, `stored.bytes <= stored.totalBytes`, and the supplied body's boolean `complete`. Also used when accessing evidence throws. |
| `invalid_header` | Header type, 8,192-character limit, and forbidden control characters. Arrays are unsupported. |
| `identity_not_confirmed` | The saved prefix's representation bytes have not been explicitly confirmed. |
| `headers_incomplete` | The relevant response metadata has not been explicitly confirmed complete and visible. |
| `unsupported_method` | The actual request method is not exactly `GET`. |
| `invalid_request_range` | Missing or unsupported request range, unsafe bounds, suffix range, or multiple ranges. |
| `request_offset_mismatch` | Request start differs from the saved prefix length. |
| `invalid_stored_etag` | Stored ETag is missing, weak, or malformed. |
| `if_range_mismatch` | Supplied `If-Range` is unsupported or differs from the stored strong ETag. |
| `unsupported_status` | Response status is outside `200`, `206`, and `416`. |
| `invalid_content_range` | Required response range is absent, malformed, impossible, or outside safe numeric bounds. |
| `unsupported_encoding` | A `206` has a supplied content coding other than `identity`. |
| `unsupported_content_type` | A `206` has a supplied Content-Type without a supported single `type/subtype`, or containing any comma. |
| `unsupported_multipart` | A `206` uses a `multipart/` content type. |
| `response_etag_mismatch` | A `206` lacks a matching strong returned ETag. |
| `response_offset_mismatch` | Response start differs from the saved prefix length. |
| `response_end_exceeds_request` | Response end is beyond the actual bounded request end. |
| `total_mismatch` | A response total differs from the known stored total, or its end reaches/exceeds that total. |
| `content_length_mismatch` | Supplied `206` Content-Length is not one valid decimal count equal to the range length. |
| `body_incomplete` | Supplied body evidence says clean EOF was not reached. |
| `body_length_mismatch` | Completed body count differs from the response range length. |

## Integrating an application-owned download

Use a staged, bounded workflow:

1. Verify the saved file's provenance, prefix length, identity coding, final resource, representation-selection context, and stored validator. Keep a coherent snapshot while this request runs.
2. Issue a bounded single-range GET from that offset. Apply your own segment-size limit, timeout, cancellation, redirect, and authentication policy.
3. Capture the actual request and complete relevant response metadata. Audit without `body`. For `restart`, `revalidate`, or `reject`, stop the append path and handle that decision separately.
4. For `await-body`, compare `expectedBodyBytes` against your configured segment cap. Stream to a separate temporary file or a bounded staging buffer with backpressure. Count payload bytes, abort on excess bytes or transfer error, and leave the existing prefix untouched.
5. After clean EOF, audit the same metadata with the observed `body: { bytes, complete: true }`. A count guessed from headers is not observed evidence.
6. Only for `append`, and after confirming the saved prefix has not changed concurrently, commit the staged segment using your own crash-safe storage strategy. Advance persisted state only after the write succeeds. Perform any expected digest or full-file verification separately before publishing the completed file.

The library supplies none of the stream, temporary-file, locking, rollback, retry, or commit operations above. Do not append first and audit afterward. Do not buffer an unbounded download merely to obtain its byte count. A `restart` recommendation does not delete or truncate a file and does not authorize your application to overwrite one without its own storage policy.

## Limitations and troubleshooting

- **Fetch and CORS:** Fetch can decode content codings, and a browser CORS response can hide relevant headers. A `null` result from `headers.get()` is insufficient proof that a header was absent on the response. Establish relevant-header exposure and byte provenance in the client/server integration before making either assertion. See the [Fetch response-filtering model](https://fetch.spec.whatwg.org/#concept-filtered-response-cors) and [content-coding handling](https://fetch.spec.whatwg.org/#http-network-fetch). No universal Fetch adapter is provided.
- **The server omitted a returned ETag:** This policy rejects that `206`, even if `If-Range` was sent. The request header alone does not prove the response matches saved state.
- **The ETag has `W/`:** Weak validators and date-based `If-Range` are outside this policy. Obtain suitable evidence or use a separate fresh-download path.
- **Content-Length is absent:** That is supported. The response range establishes the expected count, which must still be observed through clean EOF.
- **The complete length is unknown:** `bytes start-end/*` is supported. Known stored length is used when available; otherwise `range.total` is `null` and `reachesEnd` remains `false`.
- **Content-Type contains a comma:** This policy rejects all comma-bearing values to avoid accepting comma-joined duplicate fields. That includes a comma inside an otherwise valid quoted parameter. This is an intentional limitation, not a claim that such parameters are universally invalid HTTP. Other parameter syntax is not fully parsed.
- **A `416` length equals the saved length:** That is still `revalidate`. Equal lengths cannot establish saved-file integrity or provenance.
- **A range is valid HTTP but gets rejected:** This is a conservative application policy, not a general HTTP conformance checker. Multipart, suffix/multiple ranges, non-GET methods, encoded representations, weak validators, and values beyond safe integers are deliberately unsupported.
- **A completed body has the right size but wrong contents:** The auditor cannot detect that. Use independently trusted integrity data when the application requires it. ETags do not provide an authenticity guarantee.
- **The audit passes and storage later fails:** `append` describes supplied evidence at audit time. File locking, race prevention, disk limits, write errors, and crash recovery remain your application's responsibility.

## Why this package, and alternatives

The intended use is an application that already owns download I/O and wants a small, inspectable decision from a captured set of evidence. Existing tools may fit your application better:

- [`content-range`](https://github.com/gregberge/content-range) parses and formats the response field. Use it when that field-level operation is sufficient.
- [`range-parser`](https://github.com/jshttp/range-parser) parses request ranges and can combine overlapping or adjacent ranges.
- [Undici's retry handler](https://github.com/nodejs/undici/blob/main/lib/handler/retry-handler.js) already performs related range and validator checks inside a request/retry lifecycle. Prefer an integrated client when you want it to own that lifecycle.
- [`@millcrest/file-fetcher`](https://www.npmjs.com/package/@millcrest/file-fetcher) targets a broader browser-download workflow with workers and persistent storage. Evaluate that approach if you need a download manager.

The useful distinction here is a standalone, zero-I/O audit with explicit caller evidence and diagnostics. The comparison reflects reviewed public APIs, not a claim that no other standalone alternative exists or that adoption is established.

Real regressions informed the fixture choices: Firefox's [fixed resume-fallback bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1819001#c13) and Undici's [closed zero-offset range issue](https://github.com/nodejs/undici/issues/2986). These are historical examples, not claims that the current projects remain broken.

The underlying HTTP concepts are described in RFC 9110: [If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5), [byte ranges](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.1.2), [Content-Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.4), [combining partial content](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7.3), and [416](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.17). The implementation and policy are original; these links are references, not copied implementation sources.

## Runnable example and related tool

[`examples/audit-fixtures.mjs`](examples/audit-fixtures.mjs) checks a staged
`206`, a zero-offset resume, and the required restart on a `200` fallback. It is
executed by `npm run check` and ships in the npm tarball.

For planning legal S3 multipart upload ranges before sending data, see
[`s3-multipart-planner`](https://www.npmjs.com/package/s3-multipart-planner).

## Development and support

```sh
npm ci
npm run check
```

The aggregate check runs linting, TypeScript checks, builds, tests with coverage reporting, the local fixture example, and a package dry run. A CI workflow is provided for Node.js 22 and 24; its presence is not evidence that hosted CI has run.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Use the repository's issue templates for ordinary problems and the private routes described in the security policy for vulnerabilities. Do not publish credentials or private response data in reports.

## License

MIT © 2026 Huzaifa Asif. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
