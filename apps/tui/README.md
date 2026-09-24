# tui — self-hosting installer

Terminal wizard (built with [OpenTUI](https://github.com/sst/opentui)) that
installs, reconfigures, and updates a Docker Compose deployment of the wiki.
User-facing docs: `apps/docs/content/docs/self-hosting/installer.mdx`.

It must run inside a checkout of this repository — it locates the repo root by
walking up to the directory that contains `docker-compose.yml`.

```bash
pnpm dev:tui                              # from the repo root (needs Bun)
pnpm --filter tui test                    # unit tests (vitest)
pnpm --filter tui check-types
pnpm --filter tui compile                 # single binary in dist/
```

Release binaries are built per platform by `.github/workflows/release.yml`.
