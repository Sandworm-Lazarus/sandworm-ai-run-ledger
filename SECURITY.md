# Security notes

This application processes user-selected text locally and does not execute imported code or call model providers. Read [the threat model](docs/THREAT_MODEL.md) before using it with sensitive logs.

For a reproducible bug report, use synthetic records and describe the expected/observed behavior. Do not post API keys, private prompts, personal logs, billing identifiers or other secrets in a public issue. Public reports should contain only a minimal fabricated reproduction.

The repository has no dedicated incident-response SLA. No hosted service, credential vault or model gateway is operated by this code.
