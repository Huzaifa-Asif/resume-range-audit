# Security policy

## Status and scope

Security fixes are provided on the latest published `1.0.x` release; older patch
releases may be asked to upgrade before a report is investigated.

The package audits supplied metadata and counts. It cannot authenticate a server, inspect bytes, hash a file, prevent races, validate caller assertions, or guarantee storage correctness. The caller must establish that saved state and the actual request describe the same final resource and selected representation, that bytes are identity coded, and that all relevant response headers are available.

Incorrect append eligibility, accepting malformed evidence that bypasses the documented policy, or unexpectedly unbounded parser work can warrant a security report. Deliberately unsupported HTTP features are not automatically security vulnerabilities.

## Report privately when possible

The maintainer is [Huzaifa Asif (`Huzaifa-Asif`) on GitHub](https://github.com/Huzaifa-Asif).

- If the project repository's Security tab offers **Report a vulnerability**, use that private reporting route.
- Otherwise, use a private contact method the maintainer explicitly publishes on their GitHub profile. This document does not claim that a particular private contact or private-reporting feature is currently available.
- If neither route is available, request a private reporting channel through an available project contact surface. Keep the request minimal and do not disclose exploit details publicly.

Do not put secrets, authorization headers, cookies, signed URLs, customer files, or sensitive response bodies in public issues. Use synthetic data in the reproduction. Do not test against systems you do not own or have permission to assess.

A useful report includes:

1. Package version or source revision and Node.js version.
2. A small input fixture and the returned action/code.
3. The expected result, impact, and which documented preconditions you established.
4. A minimal offline reproduction or proposed regression test.

There is no guaranteed response or remediation timeline. Disclosure timing and any fix can be discussed with the maintainer once a private channel is established.

## Integration precautions

Use bounded staging and timeouts. Retain the saved prefix until the completed response passes the audit and your commit succeeds. Treat incomplete streams, hidden headers, unknown byte provenance, changed validators, and concurrent file changes as reasons to stop the append path. Verify integrity independently when required. Never mark a saved file complete based only on `416` or `reachesEnd`.
