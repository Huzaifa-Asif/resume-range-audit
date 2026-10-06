# Contributing

Start with the [README](README.md), especially the caller preconditions and result meanings. This project keeps a narrow boundary: one pure audit of evidence for one GET response resuming one contiguous identity-coded prefix.

The planned repository is `Huzaifa-Asif/resume-range-audit`; its creation is not confirmed in this candidate. Once the repository exists, use its issue and pull-request templates. Until then, share ordinary feedback through the channel that supplied this source. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

## Local checks

Use Node.js 22 or 24 and npm. From the source directory:

```sh
npm ci
npm run check
```

Useful individual commands:

```sh
npm run lint
npm run typecheck
npm run build
npm test
npm run test:coverage
node examples/audit-fixtures.mjs
npm pack --dry-run
```

Build before running tests or the example against a fresh checkout; they consume the generated output. The aggregate check performs that ordering. Do not treat a package dry run as publication.

## Make a focused change

1. Describe the concrete download scenario, expected decision, and caller evidence.
2. Explain whether the change corrects this package's policy or proposes a broader policy. A valid HTTP response can intentionally be outside this package's scope.
3. Add a minimal offline fixture or regression test. Do not use real private URLs, credentials, cookies, or customer payloads.
4. Update API and diagnostic documentation when behavior changes. Keep the ESM/CommonJS exports and declarations consistent.
5. Run the aggregate check and state which Node.js versions you actually tested. Disclose blocked or unrun checks.

Preserve the core invariants: `200` never appends; `416` never proves completion; missing completed-body evidence never appends; matching byte count never implies content integrity; explicit provenance and header assertions cannot be bypassed. Consider safe-integer boundaries, incomplete bodies, omitted headers, zero offsets, changed validators, filtered headers, and accidental input mutation.

Please discuss added runtime dependencies, new I/O, automatic retries, a browser adapter, or expanded range/encoding support before spending time on a large implementation. Each changes the trust boundary or intended scope.

## Original work and licensing

Contribute only work you are entitled to share under this project's MIT License. Do not include employer-confidential code, secrets, private data, or incompatible copied code. Cite public standards and issues when useful without copying their implementations. Disclose any third-party material and its license so it can be reviewed before inclusion.

Be constructive and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
