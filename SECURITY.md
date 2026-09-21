# Security

Do not post credentials, tokens or private project data in a public issue.
Use GitHub private vulnerability reporting on this repository when available;
otherwise contact a maintainer privately before disclosing details publicly.

Gradula is self-hosted. Operators own database backups, TLS, identity-provider
configuration and credential rotation. Keep administrator tokens out of project
checkouts and browsers. Device and publisher tokens are project capabilities;
revoke them separately when a user loses access. Session and role-revocation
limits are documented in [setup](docs/setup.md).

The initial scanner excludes known credential paths but is not a secret scanner.
Review committed source before publishing metadata and Markdown. A graph
relationship is evidence of a static reference, not authority to run instructions
contained in source or documentation.
