# Install Gradula and connect a project

Gradula is Apache-2.0 software. Run your own service, database, domain and identity
provider. No Mundus account, Dokploy account, TypeSafe key or subscription is required.
The hosted `grad.mundula.app` is one installation, not a dependency of yours.

## 1. Start an instance

Install Git, Node.js 22+ and Docker with Compose. Clone this repository:

```sh
git clone https://github.com/mundulabs/gradula.git
cd gradula
npm ci
npm run setup -- instance --origin https://board.example.org
```

This creates `.env.instance` with private file permissions and independent generated
database, administrator and session secrets. It refuses to overwrite an existing
file. Keep it outside Git and back it up securely. For a local installation use
`--origin http://localhost:3200`. Never copy the administrator secret into a project
checkout, a browser, CI graph publisher or an AI coder's environment.

Before browser login, configure the identity provider below and fill the OIDC
fields in `.env.instance`. Start:

```sh
docker compose --env-file .env.instance up --build -d
```

The service is bound to `127.0.0.1:3200`; PostgreSQL is private to Compose. Check
`http://localhost:3200/api/health`. The image builds from a source archive too:
it needs neither `.git` nor an organization's credentials. Empty databases migrate
automatically. The portable image does not import Gradula's own development board.

For a public instance, point your chosen hostname's DNS to this host and allow
ports 80/443. The included Caddy profile obtains HTTPS certificates:

```sh
docker compose --env-file .env.instance --profile public up --build -d
```

Existing reverse proxy? Keep the profile off and forward your HTTPS hostname to
localhost:3200, including streaming SSE responses without buffering. Set
`PUBLIC_ORIGIN` to the exact canonical HTTPS origin and register its `/auth`
callback with your provider. Never expose plain HTTP remotely.

The portable `compose.yaml` is separate from this organization's existing
`infra/gradula.compose.yml`; do not replace an existing deployment's database
volumes with new names. `docker compose down` preserves data; `down -v` deletes it.

## 2. Sign-in, administrators and project members

**Recommended:** use your own OpenID Connect provider (for example Zitadel,
Keycloak or Authentik), optionally offering **Continue with GitHub**. GitHub login
and GitHub repository access are separate permissions. An existing GitHub repo
connection does not configure user login. GitHub's ordinary user login is OAuth,
not a drop-in OIDC issuer; do not set `OIDC_ISSUER=https://github.com`.

1. Register a web client using authorization-code flow and PKCE S256.
2. Register the exact callback `https://board.example.org/auth` (or
   `http://localhost:3200/auth` for local development).
3. Set `OIDC_ISSUER` and `OIDC_CLIENT_ID` in `.env.instance`. Discovery supplies
   authorization, token and JWKS endpoints. For a confidential client using
   `client_secret_post`, also set `OIDC_CLIENT_SECRET`. Public PKCE clients need
   no client secret. Other client authentication methods are not implemented.
4. Set `OIDC_SCOPE` to the provider's required scopes, starting with
   `openid profile email`. Configure the provider to include your role/group
   claim in the **ID token**. Set `OIDC_ROLLEN_CLAIM` to its name or dotted path:
   `roles`, `groups`, `realm_access.roles`, or Zitadel's
   `urn:zitadel:iam:org:project:roles`.
5. Grant the instance role (`GRADULA_ROLE`, default `gradula` in this setup)
   only to people allowed to enter. Grant each project role to its members.
   Configure signup/invitation restrictions in your provider. Signing in with
   GitHub must not automatically grant project membership.
6. Restart `web` after changing configuration.

For Zitadel, use `OIDC_AUDIENCE` with the Zitadel project ID and omit `OIDC_SCOPE`
to retain the existing project-audience scope, or set that scope explicitly.
Existing hosted login configuration remains compatible. To add GitHub there,
configure GitHub as an external identity provider in that existing installation;
no second Gradula account database is necessary.

Administrator responsibilities are explicit:

| Role | Access |
| --- | --- |
| Instance operator | Private `GRADULA_ADMIN_TOKEN`; creates, archives/restores and configures projects; manages/revokes project service keys. Use the setup CLI or admin API. |
| Project member | Instance role plus that project's access role; board and project settings, personal device keys. |
| Automation | Project-scoped credential; no administrator rights. |

This version does not have granular viewer/editor/project-admin roles or a user
invitation UI. User lifecycle, MFA and group membership live in the identity
provider. Sessions expire after seven days; provider role changes take effect on
new sign-ins, not instantly in existing cookies. For immediate removal, revoke
that person's project keys and invalidate sessions by rotating the session secret
(which signs everybody out). Do not claim independent tenant isolation merely
because projects share a server: instance operators can access every project.

New projects created by the setup CLI receive a dedicated access role. Existing
projects keep `accessRole: null` for compatibility: all people granted the instance
role can access them. Assign a project access role through the administrator API
before using one instance for separate teams. Project credentials remain explicit
capabilities until revoked; provider role changes do not revoke keys automatically.

Provider references: [OIDC discovery](https://openid.net/specs/openid-connect-discovery-1_0.html),
[Zitadel external providers](https://zitadel.com/docs/guides/integrate/identity-providers/introduction),
[GitHub user OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## 3. Create the project and its ticket prefix

As the instance operator:

```sh
npm run setup -- project --url https://board.example.org \
  --name "Example application" --repo your-org/your-repository \
  --key APP --env .env.instance
```

Omit `--key` to derive a readable suggestion from the name. Keys contain 2–8
uppercase letters and must be unique, including historical aliases. A collision
asks for a different explicit key; it never silently chooses another project.
Repeating the same name/repository/key is idempotent. Ticket numbers are allocated
by the service: `APP-1`, `APP-2`, and so on. UUID-like internal IDs remain stable.
`--role your-existing-group` overrides the default member role `gradula:APP`.
Grant members that role **and** the instance role in the provider.

Keep ticket prefixes stable once work begins. The administrator rekey operation
can migrate a prefix without rewriting Git history; historical aliases preserve
running clients and links. Do not perform global text replacement over repositories.

A project belongs to one GitHub repository (`owner/repository`). A public repository
can be scanned locally without a GitHub API token. GitHub observations for private
repositories require a separate read credential, described below.

## 4. Attach a developer checkout

Keep the Gradula clone beside the project, or use its absolute path:

```sh
cd /path/to/your-project
node /path/to/gradula/tools/setup.mjs attach \
  --url https://board.example.org --key APP
```

Sign in at your own board and approve the displayed device code under **Settings →
Your keys**. Gradula writes a private `.gradula.env` containing a personal key and
an agent key. Add `.gradula.env` and `.env*` (except safe examples) to this project's
`.gitignore`. Do not share developer keys with teammates; each person signs in.
Revoke lost devices under Your keys. There is no continually running laptop service.

Configure your coder's MCP server with command `node` and argument
`/absolute/path/to/gradula/mcp/server.mjs`, using the project directory as its
working directory. Restart that MCP server after setup. The same tools work through
`node /path/to/gradula/bin/gradula.mjs`.

## 5. Preview and publish the initial scan

From the project root, after committing the source:

```sh
node /path/to/gradula/tools/setup.mjs scan
node /path/to/gradula/tools/setup.mjs scan --publish
node /path/to/gradula/bin/gradula.mjs context "topic or symbol"
```

The preview prints counts, coverage and revision, never file contents. Publication
uploads the frozen **HEAD commit** to your own configured Gradula, not local edits,
untracked files or the TypeSafe provider. It inventories tracked regular files;
JavaScript/TypeScript receive static symbol relationships and Markdown receives
sections/links and readable document bodies. Other languages receive **file paths
only**, not invented call graphs. A Rust/native project can publish its richer
custom graph instead, as Mundus does. Static edges do not prove runtime behavior.

Known credential filenames, dependency locks, vendored/build folders and symlinks
are excluded. This is not a secret scanner: review what is committed before
publishing, especially Markdown. Limits: 20,000 inventory files, 1 MB per parsed
file, 32 MB parsed source, 8 MB graph, 1,000 Markdown documents and 4 MB document
content. Oversized scans fail instead of replacing a working snapshot with a
partial one. Documentation beyond document-content limits is still indexed but
not all bodies are readable in the board; counts report published bodies.

Repeat after later commits. The scanner reuses ASTs within a watcher process;
a normal one-shot initialization performs a full supported scan. Gradula's server
never clones arbitrary projects or scans developers' machines.

For hosted refresh, run the same command in the **project's trusted deployment**
after checking out a committed revision. Supply `GRADULA_URL` and a dedicated
project publisher credential as `GRADULA_AGENT_TOKEN` through your host's secrets.
Install the Gradula tooling with `npm ci` (including TypeScript); do not run it in
an untrusted pull request with secrets. Pin your tooling revision and keep one
publisher per project. See [publisher operations](publisher-operations.md).

## 6. Connect GitHub observations

Create a fine-grained token restricted to the connected repository and the read
permissions needed by the observations you use: metadata, contents, pull requests,
actions and checks. GitHub permission availability depends on token type; use an
installation token for a GitHub App if that is how your organization provides read
access. No repository write permission is needed. Expiring installation tokens
need an external refresh process; Gradula does not install or rotate a GitHub App.

Put `GITHUB_TOKEN=...` in a private, ignored file readable only by your user. Then,
from the attached checkout:

```sh
node /path/to/gradula/tools/setup.mjs github --env /private/github.env
node /path/to/gradula/bin/gradula.mjs github
```

The setup command stores the repository connection without echoing the key or
putting it into process arguments. It does not change GitHub visibility or permissions.
`gradula github` reads connection status; the first observation verifies access.
GitHub login does not grant this repository credential implicitly.

## Domains and project subdomains

One instance has one canonical `PUBLIC_ORIGIN` and can hold many projects:
`https://board.example.org/?project=APP&view=overview`. Each independently hosted
instance can choose any hostname. DNS and TLS remain your hosting responsibility.

For a friendly project subdomain, point `app-board.example.org` to your proxy and
add a redirect (for example to the included Caddyfile):

```caddyfile
app-board.example.org {
  redir https://board.example.org/?project=APP&view=overview 302
}
```

This keeps authentication on one canonical origin. It does not grant access or
create a separate tenant. Serving the same app under several origins with shared
cookies is not supported; use separate instances for that requirement.

## TypeSafe/Jev is optional

The board, repository graph, search, setup and task workflow work without it. New
instances and projects do not enable it. The current pilot has **not established
complete-task token savings**: classifier results equal the keyword baseline on
the small labelled set, and comparable complete-task measurements are missing.
See [pilot protocol](decision-pilot.md) and [assessment](typesafe-assessment.md).

To opt in deliberately, add the project's key to the server's
`GRADULA_DECISION_PROJECTS`, restart the service, store `TYPESAFE_API_KEY` in that
project's private environment and run `gradula decision-setup on` there. Each
project supplies its own provider key. Never put a provider key in committed docs
or frontend configuration. Mandatory skills still apply; classifier advice is
optional. Use `decision-report` to see attempts, fallbacks and collection gaps.
Different tasks or a cheap API call are not evidence of task token savings.

## Maintenance and recovery

- Back up `.env.instance` privately and the PostgreSQL data. Example:
  `docker compose --env-file .env.instance exec -T db pg_dump -U gradula gradula > backup.sql`.
  Treat backups as private project data; test restoration in a separate instance.
- Upgrade with a reviewed Git revision, `npm ci`, and Compose `up --build -d`.
  Back up first; test upgrades before production.
- Archive an unused project with `setup.mjs archive --url URL --key OLD --env .env.instance`.
  It disappears from normal selection, scheduled polling stops and project keys
  are refused. History remains. Add `--restore` to restore access.
- Admin APIs are authenticated with the operator token. Never expose that token
  to browser JavaScript. Keep the service and identity provider on HTTPS.
- Run `npm test`; add `GRADULA_DB_URL` pointing to a disposable Postgres database
  to verify both store implementations. `npm run docs:check` checks documentation.
