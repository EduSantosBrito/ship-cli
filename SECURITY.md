# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Ship, please report it responsibly.

**Do not create public GitHub issues for security vulnerabilities.**

### How to Report

1. **GitHub Security Advisories** (preferred): Use [GitHub's private vulnerability reporting](https://github.com/EduSantosBrito/ship-cli/security/advisories/new)
2. **Email**: Contact the maintainer directly

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Resolution timeline**: Depends on severity and complexity

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | Yes                |
| < Latest | Best effort       |

## Security Best Practices

When using Ship:

1. **Protect your Linear API key**: Store it securely in `~/.ship/config.yaml` (auto-created by `ship init`)
2. **Review permissions**: Ship requires read/write access to Linear issues
3. **Keep dependencies updated**: Run `npm update` or `pnpm update` regularly

## Scope

The following are in scope for security reports:

- Authentication/authorization issues
- Data exposure vulnerabilities
- Command injection
- Dependency vulnerabilities

The following are out of scope:

- Social engineering attacks
- Physical attacks
- Issues in third-party services (Linear, GitHub)
