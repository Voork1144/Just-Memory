# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 5.x     | Yes                |
| 4.3.x   | Deprecated         |
| < 4.3   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in Just-Memory, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use one of these methods:

1. **GitHub Security Advisories** (preferred): Go to the [Security tab](https://github.com/Voork1144/Just-Memory/security/advisories) and click "Report a vulnerability"
2. **Email**: Contact the maintainer directly through GitHub

## What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: Within 2 weeks for critical issues

## Scope

The following are in scope:

- SQL injection in query parameters
- Path traversal in backup/restore operations
- ReDoS in pattern matching
- Memory data leakage across projects
- Arbitrary code execution via model loading

The following are out of scope:

- Vulnerabilities in upstream dependencies (report to the respective projects)
- Issues requiring physical access to the machine running the server
- Social engineering attacks
