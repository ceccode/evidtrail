# Security Policy

## Supported versions

Security fixes are released for the latest published version of evidtrail. Before
reporting, please reproduce the issue on that version when it is safe to do so.

## Reporting a vulnerability

Please use GitHub's private **Report a vulnerability** form in the Security tab
of this repository. Do not open a public issue for a vulnerability that could
put users, repositories, tokens, or CI environments at risk.

Include, where possible:

- the affected command and evidtrail version;
- the operating system and Node.js version;
- a minimal reproduction using non-sensitive data;
- the expected impact and any known mitigations.

We will acknowledge a report as soon as practical, keep the reporter informed
while it is investigated, and coordinate disclosure after a fix is available.

## Scope

evidtrail executes Git commands against repositories supplied by its users and can
optionally call forge APIs. Repository contents, Git metadata, configuration,
file names, API responses, and generated artifacts are treated as untrusted
input. Reports about command execution, credential exposure, path handling,
unsafe CI defaults, or misleading security/privacy guarantees are in scope.
