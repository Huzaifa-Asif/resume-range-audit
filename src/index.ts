/** All counts refer to untransformed, identity-coded representation bytes. */
export interface AuditInput {
  readonly stored: {
    readonly bytes: number;
    readonly etag: string;
    readonly totalBytes?: number;
    /** Caller assertion about the saved contiguous prefix. */
    readonly identityEncoded: boolean;
  };
  readonly request: {
    readonly method: 'GET';
    readonly range: string;
    readonly ifRange?: string | null;
  };
  readonly response: {
    readonly status: number;
    /** Caller assertion: relevant headers are visible, unfiltered, and not discarded. */
    readonly headersComplete: boolean;
    readonly contentRange?: string | null;
    readonly contentLength?: string | null;
    readonly etag?: string | null;
    readonly contentEncoding?: string | null;
    readonly contentType?: string | null;
  };
  /** Supply only an observed count; complete is true only after clean EOF. */
  readonly body?: { readonly bytes: number; readonly complete: boolean };
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
  /** null means neither the response nor stored state supplied a known total. */
  readonly total: number | null;
}

const MESSAGES = {
  invalid_input: 'Expected the documented input shape and non-negative safe integer counts.',
  invalid_header: 'Header fields must be single strings, at most 8192 characters, without forbidden control characters.',
  identity_not_confirmed: 'The saved prefix must be confirmed as untransformed identity-coded bytes.',
  headers_incomplete: 'Complete, unfiltered relevant response headers must be confirmed by the caller.',
  unsupported_method: 'Only GET requests are supported.',
  invalid_request_range: 'Expected one bytes=start-end or bytes=start- request range with safe integer bounds.',
  request_offset_mismatch: 'The request range must start exactly at the saved prefix length.',
  invalid_stored_etag: 'A syntactically valid strong stored ETag is required by this policy.',
  if_range_mismatch: 'If-Range, when supplied, must equal the stored strong ETag; dates and weak tags are unsupported.',
  unsupported_status: 'Only 200, 206, and 416 response decisions are supported.',
  invalid_content_range: 'Content-Range is missing, malformed, inconsistent, or outside supported safe integer bounds.',
  unsupported_encoding: 'Encoded response bytes are outside this identity-only policy.',
  unsupported_multipart: 'Multipart range responses are outside this single-range policy.',
  unsupported_content_type: 'Content-Type must be a single type/subtype; comma-bearing fields are outside this policy.',
  response_etag_mismatch: 'A returned strong ETag equal to the stored ETag is required by this policy.',
  response_offset_mismatch: 'The response range does not start exactly at the saved prefix length.',
  response_end_exceeds_request: 'The response extends beyond the requested final byte.',
  total_mismatch: 'The response range conflicts with the known stored representation length.',
  content_length_mismatch: 'Content-Length must be a single valid decimal count equal to the response range length.',
  body_incomplete: 'The response body did not reach a confirmed clean EOF; do not append it.',
  body_length_mismatch: 'The completed response body count does not equal the response range length.',
} as const;

export type RejectCode = keyof typeof MESSAGES;
export type AuditResult =
  | Readonly<{ action: 'reject'; code: RejectCode; message: string }>
  | Readonly<{ action: 'restart'; code: 'full_response'; message: string }>
  | Readonly<{ action: 'revalidate'; code: 'range_unsatisfied'; message: string; totalBytes: number }>
  | Readonly<{ action: 'await-body'; code: 'body_required'; message: string; range: ByteRange; expectedBodyBytes: number }>
  | Readonly<{ action: 'append'; code: 'append_eligible'; message: string; range: ByteRange; bodyBytes: number; nextOffset: number; reachesEnd: boolean }>;

// Reference equality does not inspect a caller-thrown object or Proxy.
const INVALID_INPUT = new Error(MESSAGES.invalid_input);
const INVALID_HEADER = new Error(MESSAGES.invalid_header);

function reject(code: RejectCode): AuditResult {
  return Object.freeze({ action: 'reject', code, message: MESSAGES[code] });
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw INVALID_INPUT;
  return value as Record<string, unknown>;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decimal(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return isCount(parsed) ? parsed : null;
}

function header(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) {
    throw INVALID_HEADER;
  }
  // Only HTTP optional whitespace; do not silently remove Unicode whitespace.
  // Explicit indices keep interior whitespace runs linear rather than backtracking.
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === ' ' || value[start] === '\t')) start += 1;
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) end -= 1;
  return value.slice(start, end);
}

function isStrongEtag(value: string | undefined): value is string {
  // Entity tags are opaque: commas and backslashes are allowed inside one tag.
  return value !== undefined && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

function requestRange(value: string | undefined): { start: number; end: number | null } | null {
  const match = value === undefined ? null : /^bytes=([0-9]+)-([0-9]*)$/i.exec(value);
  if (match === null) return null;
  const start = decimal(match[1]!);
  const end = match[2] === '' ? null : decimal(match[2]!);
  if (start === null || (match[2] !== '' && end === null) || (end !== null && end < start)) return null;
  return { start, end };
}

function responseRange(value: string | undefined): ByteRange | null {
  const match = value === undefined ? null : /^bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)$/i.exec(value);
  if (match === null) return null;
  const start = decimal(match[1]!);
  const end = decimal(match[2]!);
  const total = match[3] === '*' ? null : decimal(match[3]!);
  if (start === null || end === null || (match[3] !== '*' && total === null) || end < start || !isCount(end + 1) || (total !== null && end >= total)) return null;
  return { start, end, total };
}

/**
 * Decide append eligibility under supplied evidence, without reading a stream or file.
 * The caller must bind stored state and this request to the same final resource and
 * selected representation. This does not verify hashes, storage, or server honesty.
 * Malformed evidence returns reject, including throwing property accessors.
 */
export function auditResumeResponse(input: AuditInput): AuditResult {
  try {
    const root = record(input);
    const stored = record(root.stored);
    const request = record(root.request);
    const response = record(root.response);
    // Snapshot each field once: accessors cannot change evidence between checks.
    const bytes = stored.bytes;
    const totalBytes = stored.totalBytes;
    const identityEncoded = stored.identityEncoded;
    const method = request.method;
    const status = response.status;
    const headersComplete = response.headersComplete;
    if (!isCount(bytes) || (totalBytes !== undefined && (!isCount(totalBytes) || bytes > totalBytes))) return reject('invalid_input');
    if (identityEncoded !== true) return reject('identity_not_confirmed');
    if (method !== 'GET') return reject('unsupported_method');
    if (headersComplete !== true) return reject('headers_incomplete');

    const storedEtag = header(stored.etag);
    const rangeHeader = header(request.range);
    const ifRange = header(request.ifRange);
    const contentRange = header(response.contentRange);
    const contentLength = header(response.contentLength);
    const etag = header(response.etag);
    const contentEncoding = header(response.contentEncoding);
    const contentType = header(response.contentType);
    const requested = requestRange(rangeHeader);
    if (requested === null) return reject('invalid_request_range');
    if (requested.start !== bytes) return reject('request_offset_mismatch');
    if (!isStrongEtag(storedEtag)) return reject('invalid_stored_etag');
    if (ifRange !== undefined && (!isStrongEtag(ifRange) || ifRange !== storedEtag)) return reject('if_range_mismatch');

    if (status === 200) {
      return Object.freeze({ action: 'restart', code: 'full_response', message: 'This is a full response. Do not append it; a fresh download requires a separate storage decision.' });
    }
    if (status === 416) {
      const match = contentRange === undefined ? null : /^bytes \*\/([0-9]+)$/i.exec(contentRange);
      const total = match === null ? null : decimal(match[1]!);
      if (total === null) return reject('invalid_content_range');
      return Object.freeze({ action: 'revalidate', code: 'range_unsatisfied', totalBytes: total, message: 'Revalidate the saved representation. An unsatisfied range and matching length do not prove file completeness.' });
    }
    if (status !== 206) return reject('unsupported_status');
    if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== 'identity') return reject('unsupported_encoding');
    if (contentType !== undefined && (contentType.includes(',') || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:[ \t]*;.*)?$/.test(contentType))) return reject('unsupported_content_type');
    if (contentType !== undefined && /^multipart\//i.test(contentType)) return reject('unsupported_multipart');
    if (!isStrongEtag(etag) || etag !== storedEtag) return reject('response_etag_mismatch');

    const ranged = responseRange(contentRange);
    if (ranged === null) return reject('invalid_content_range');
    if (ranged.start !== bytes) return reject('response_offset_mismatch');
    if (requested.end !== null && ranged.end > requested.end) return reject('response_end_exceeds_request');
    if (totalBytes !== undefined && ((ranged.total !== null && ranged.total !== totalBytes) || ranged.end >= totalBytes)) return reject('total_mismatch');
    const range: ByteRange = Object.freeze({ ...ranged, total: ranged.total ?? totalBytes ?? null });
    const expectedBodyBytes = range.end - range.start + 1;
    if (contentLength !== undefined && decimal(contentLength) !== expectedBodyBytes) return reject('content_length_mismatch');

    const bodyEvidence = root.body;
    if (bodyEvidence === undefined) {
      return Object.freeze({ action: 'await-body', code: 'body_required', message: 'Headers meet this policy. Stage the response and verify its byte count after clean EOF before appending.', range, expectedBodyBytes });
    }
    const body = record(bodyEvidence);
    const bodyBytes = body.bytes;
    const complete = body.complete;
    if (!isCount(bodyBytes) || typeof complete !== 'boolean') return reject('invalid_input');
    if (!complete) return reject('body_incomplete');
    if (bodyBytes !== expectedBodyBytes) return reject('body_length_mismatch');
    const nextOffset = range.end + 1;
    return Object.freeze({ action: 'append', code: 'append_eligible', message: 'Append eligibility is established under the supplied evidence; file contents and storage are not verified.', range, bodyBytes, nextOffset, reachesEnd: range.total !== null && nextOffset === range.total });
  } catch (error) {
    return reject(error === INVALID_HEADER ? 'invalid_header' : 'invalid_input');
  }
}
