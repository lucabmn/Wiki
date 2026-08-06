# Getting help

Wiki is maintained by volunteers. There is no commercial support contract behind
it and no guaranteed response time — please pick the channel that matches what
you need so the people who can answer actually see it.

## Where to go

| You want to…                                             | Go to                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Deploy, upgrade or operate an instance                   | [DEPLOY.md](DEPLOY.md) — it covers TLS, backups, health, retention and SSO |
| Understand who can see or do what                        | [docs/permissions.md](docs/permissions.md)                                 |
| Know what personal data is stored, and how to remove it  | [docs/privacy.md](docs/privacy.md)                                         |
| Ask a question, or figure out whether something is a bug | [GitHub Discussions](https://github.com/lucabmn/Wiki/discussions)          |
| Report a reproducible bug                                | [Open an issue](https://github.com/lucabmn/Wiki/issues/new/choose)         |
| Propose a feature                                        | [Open an issue](https://github.com/lucabmn/Wiki/issues/new/choose)         |
| Report a **security vulnerability**                      | **Not** a public issue — see [SECURITY.md](SECURITY.md)                    |
| Contribute code                                          | [CONTRIBUTING.md](CONTRIBUTING.md)                                         |

## Before opening an issue

A bug report that can be reproduced gets fixed; one that cannot usually gets
closed. Please include:

- **Version** — the image tag or commit
  (`docker compose exec server printenv APP_VERSION`, or the version shown in
  the admin console's instance overview).
- **How you deployed** — plain `docker compose up`, the production overlay with
  Caddy, tagged GHCR images, or a build from source.
- **What you expected and what happened**, with the exact error text.
- **Logs** from the relevant service: `docker compose logs --tail=200 server`.
  Redact secrets — logs are structured and never contain mail bodies or auth
  links, but your URLs and email addresses are in there.
- **`GET /health/ready`** output if anything looks like an infrastructure
  problem. It reports the database, object storage, collab and mail separately
  and usually names the culprit outright.

## Things that are usually configuration, not bugs

Worth checking before you write the issue:

- **Login works but the session is lost on reload** → `COOKIE_DOMAIN` is unset
  while the web app and API live on different subdomains. See DEPLOY.md.
- **Nobody can open `/admin`** → `INITIAL_ADMIN_EMAIL` is not set. See
  "The first instance admin" in DEPLOY.md.
- **No invitation or password-reset mail arrives** → `SMTP_HOST` is unset, which
  disables delivery by design. `GET /health/ready` reports mail as `disabled`.
- **Attachments fail** → object storage is unconfigured or unreachable; the same
  endpoint reports it.
- **Registration is refused** → that is `SIGNUP_MODE`; the refusal message names
  the reason. See "Who may register" in DEPLOY.md.
- **The server refuses to start** → almost always env validation. The error
  names the variable.

## What we cannot help with

- Running Docker, DNS, or a mail server. Those are prerequisites; we can point
  at the relevant setting, but not debug your infrastructure.
- Restoring a deployment with no backups. Please read
  [Backups](DEPLOY.md#backups) _before_ you need it.
- Private forks with modifications, unless the problem reproduces on `main`.
