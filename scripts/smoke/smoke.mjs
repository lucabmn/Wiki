#!/usr/bin/env node
// End-to-end smoke test against a running compose stack.
//
//   node scripts/smoke/smoke.mjs
//
// CI builds the images, brings the whole stack up and runs this
// (.github/workflows/smoke.yml). It exists because everything else in CI proves
// the *code* compiles and its units behave — none of it proves that the
// assembled deployment works. Every failure this has to catch is a wiring
// failure between containers: a migration that did not run, a bucket that was
// never created, an auth cookie the browser would refuse, a WebSocket the proxy
// drops, a backup that restores into nothing.
//
// Deliberately written against the public HTTP surface with `fetch` and no
// dependencies: a smoke test that needs the app's own client library can pass
// while the deployment is broken for anything else.

const API = process.env.SMOKE_API_URL ?? "http://localhost:3000";
const WEB = process.env.SMOKE_WEB_URL ?? "http://localhost:3001";
const COLLAB = process.env.SMOKE_COLLAB_URL ?? "ws://localhost:1234";

const stamp = Date.now();
const EMAIL = `smoke+${stamp}@example.test`;
const PASSWORD = "smoke-test-password-1234";

let failures = 0;
let cookies = "";

/** One named check. Keeps going after a failure so one run reports everything. */
async function step(name, run) {
  process.stdout.write(`▶ ${name}\n`);
  try {
    await run();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(`✗ ${name}\n    ${error?.message ?? error}\n`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * `fetch` that carries the session forward.
 *
 * Better Auth's cookie is the thing most likely to be misconfigured in a real
 * deployment (SameSite, Secure, Domain), so the test holds it exactly as a
 * browser would rather than passing a bearer token around.
 */
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(cookies ? { cookie: cookies } : {}),
      ...options.headers,
    },
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const jar = new Map(
      cookies
        .split("; ")
        .filter(Boolean)
        .map((pair) => [pair.slice(0, pair.indexOf("=")), pair]),
    );
    for (const raw of setCookie) {
      const pair = raw.split(";")[0];
      jar.set(pair.slice(0, pair.indexOf("=")), pair);
    }
    cookies = [...jar.values()].join("; ");
  }
  return response;
}

async function json(path, options) {
  const response = await api(path, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${options?.method ?? "GET"} ${path} → ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

// Shared between steps.
const state = {};

await step("API reports itself healthy", async () => {
  const health = await json("/health");
  assert(health.status === "ok", `expected ok, got ${JSON.stringify(health)}`);
});

await step("every dependency is reachable", async () => {
  const response = await api("/health/ready");
  const report = await response.json();
  // 503 here means storage, collab or the database is down — exactly the class
  // of broken deployment that used to report "ok" from /health.
  assert(
    response.status === 200,
    `/health/ready is ${response.status}: ${JSON.stringify(report.checks)}`,
  );
  for (const name of ["database", "storage", "collab"]) {
    assert(report.checks[name]?.status === "ok", `${name}: ${JSON.stringify(report.checks[name])}`);
  }
});

await step("liveness answers without any dependency", async () => {
  const response = await api("/health/live");
  assert(response.status === 200, `/health/live is ${response.status}`);
});

await step("web app serves its document", async () => {
  const response = await fetch(WEB);
  assert(response.ok, `web returned ${response.status}`);
  const body = await response.text();
  assert(body.includes("<html"), "web response is not an HTML document");
});

await step("registration and sign-in", async () => {
  await json("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Smoke Test" }),
  });
  // Sign in explicitly rather than trusting the sign-up session: this is what
  // catches a cookie the browser would accept but the API would not re-read.
  await json("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await json("/api/auth/get-session");
  assert(session?.user?.email === EMAIL, "session does not belong to the registered user");
  state.userId = session.user.id;
});

await step("organization creation and activation", async () => {
  const org = await json("/api/auth/organization/create", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke ${stamp}`, slug: `smoke-${stamp}` }),
  });
  state.orgId = org.id;
  await json("/api/auth/organization/set-active", {
    method: "POST",
    body: JSON.stringify({ organizationId: org.id }),
  });
  // The active organization is stamped onto the session row, and everything
  // org-scoped below fails without it.
  const session = await json("/api/auth/get-session");
  assert(
    session.session.activeOrganizationId === org.id,
    "the new organization did not become active",
  );
});

await step("space and page creation", async () => {
  const space = await json("/v1/spaces", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke Space ${stamp}`, visibility: "private" }),
  });
  state.spaceId = space.id;

  const page = await json("/v1/pages", {
    method: "POST",
    body: JSON.stringify({ spaceId: space.id, title: "Smoke page" }),
  });
  state.pageId = page.id;
  assert(page.spaceId === space.id, "page was created in the wrong space");
});

await step("page edit is persisted", async () => {
  await json(`/v1/pages/${state.pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ id: state.pageId, title: "Smoke page edited" }),
  });
  const reloaded = await json(`/v1/pages/${state.pageId}`);
  assert(reloaded.title === "Smoke page edited", "the edit did not survive a reload");
});

await step("page tree carries the page without its body", async () => {
  const tree = await json(`/v1/spaces/${state.spaceId}/tree`);
  const node = tree.find((entry) => entry.id === state.pageId);
  assert(node, "the new page is missing from the tree");
  assert(!("content" in node), "the tree endpoint is shipping page bodies again");
});

await step("attachment upload and download", async () => {
  const bytes = new Uint8Array([0x53, 0x4d, 0x4f, 0x4b, 0x45, 0x0a]); // "SMOKE\n"
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "text/plain" }), "smoke.txt");
  form.append("spaceId", state.spaceId);
  form.append("pageId", state.pageId);

  const created = await json("/attachments/upload", { method: "POST", body: form });
  state.attachmentId = created.id;

  const download = await api(`/attachments/${created.id}/download`);
  assert(download.ok, `download returned ${download.status}`);
  const roundTripped = new Uint8Array(await download.arrayBuffer());
  assert(
    roundTripped.length === bytes.length && roundTripped.every((b, i) => b === bytes[i]),
    "the downloaded bytes differ from what was uploaded",
  );
  // User-uploaded bytes must never render inline on the API origin.
  assert(
    download.headers.get("content-disposition")?.startsWith("attachment"),
    "attachment download is not marked as a download",
  );
});

await step("collaboration socket accepts a minted token", async () => {
  const { token, docName } = await json(`/v1/pages/${state.pageId}/collab-token`, {
    method: "POST",
    body: JSON.stringify({ id: state.pageId }),
  });
  assert(token && docName, "no collaboration token was issued");

  // The handshake alone is the assertion: it proves the collab container is
  // listening, shares the API's signing secret, and accepts a page-scoped
  // token. Driving a full Yjs sync would need the client library and would be
  // testing Yjs rather than the deployment.
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${COLLAB}/${encodeURIComponent(docName)}?token=${token}`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("collab socket did not open within 10s"));
    }, 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("collab socket errored during the handshake"));
    });
  });
});

await step("the audit log recorded the work above", async () => {
  const feed = await json("/v1/activity?limit=50");
  const actions = new Set(feed.map((entry) => entry.action));
  // If activity rows are not being written, every downstream feature built on
  // them — the feed, digests, webhooks — is silently dead.
  assert(
    actions.has("page.created") || actions.has("space.created"),
    `no create actions in the activity feed: ${[...actions].join(", ") || "(empty)"}`,
  );
});

await step("rate limiting is active", async () => {
  // A misconfigured limiter is invisible until it is needed. One burst against
  // the auth ceiling is enough to prove the middleware is wired up. Runs last:
  // it deliberately exhausts this IP's auth budget for the minute.
  const attempts = await Promise.all(
    Array.from({ length: 80 }, () =>
      fetch(`${API}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password-here" }),
      }).then((r) => r.status),
    ),
  );
  assert(attempts.includes(429), "80 failed sign-ins in a row were never rate limited");
});

if (failures) {
  process.stdout.write(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nall checks passed\n");
