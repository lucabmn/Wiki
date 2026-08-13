# Learning platform

Courses live next to the wiki as a **peer product**: they share an organization
and its members, and nothing else. Wiki content is grouped into spaces and
pages; learning content is grouped into courses, chapters and lessons, with its
own access rules, its own roles and its own lifecycle.

The tables live in the `learn` Postgres schema (`packages/db/src/schema/learn/`),
the API under the `learn` namespace of the oRPC router
(`packages/api/src/routers/learn.ts`), and the UI under `/learn` in `apps/web`.

## Why a separate access model

The wiki resolves read access from a space's visibility plus membership
(`packages/api/src/lib/access.ts`). An LMS adds an axis that model does not
have: **enrolment**.

A learner is usually a plain organization member with no authoring permission
anywhere, and must still be able to open every lesson of the one course they
signed up for. A colleague holding full `page:*` rights must _not_ be able to
read that same course unless they enrol or are staff on it. Neither statement is
expressible in the space rules, so course access is resolved independently in
`packages/api/src/lib/course-access.ts` from four facts:

| Fact              | Where it comes from                                           |
| ----------------- | ------------------------------------------------------------- |
| Visibility        | `course.visibility` — `private` / `organization` / `public`   |
| Enrolment         | the caller's `enrollment` row, if any                         |
| Staff grant       | `course_member` — for a user, a team, or an organization role |
| Organization role | owner/admin only, as the administrative override              |

plus `course.status`, which gates everything: a draft is invisible to everyone
but its staff, and an archived course stays readable for the people already in
it while closing to new ones.

That module is free of env, auth and network imports, so its decision tables are
unit-tested exhaustively rather than sampled — see
`packages/api/tests/lib/course-access.test.ts`.

The resolver answers two separate questions:

- **`canView`** — the catalog card and the landing page: title, outline, price.
  Everything needed to decide whether to enrol. Never the content.
- **`canLearn`** — open lessons and record progress.

Collapsing the two is what produces either an invisible catalog or a paywall
that leaks content.

## Roles

Staff roles are ranked, and each implies every weaker one:

| Role         | May                                                 |
| ------------ | --------------------------------------------------- |
| `reviewer`   | read the course and its submissions                 |
| `assistant`  | …and grade submissions                              |
| `instructor` | …and author chapters, lessons, assignments, quizzes |
| `owner`      | …and publish, delete, manage staff and enrolments   |

Learners are **not** listed as staff. They are represented by an `enrollment`
row, so "may edit" and "is taking this" can never be conflated.

The organization-level statements (`course`, `lesson`, `enrollment`,
`submission` in `packages/auth/src/permissions.ts`) answer a different question:
may this member start a course at all, and may they administer courses they are
not staff on. Both layers apply, and an organization grant never reaches a
course the caller cannot already see.

## Content model

```
course
 └── chapter          ordered fractionally; carries the drip release rules
      └── lesson      the atom a learner opens and completes
```

A lesson has a `kind`, which decides which payload column is meaningful:

| Kind         | Payload                                                       |
| ------------ | ------------------------------------------------------------- |
| `dynamic`    | TipTap/ProseMirror JSON, the same schema the wiki editor uses |
| `video`      | an uploaded file, served through a range-aware proxy          |
| `document`   | an uploaded PDF or office document                            |
| `embed`      | an external URL (YouTube, Vimeo, an iframe-able tool)         |
| `assignment` | a hand-in with tasks and grading                              |
| `quiz`       | a graded questionnaire                                        |

The pairing is validated when a lesson is _published_, not on every save: an
author must be able to create the shell of a video lesson before the upload
finishes, but a learner must never open one that plays nothing.

Lessons are called lessons, not "activities", because `wiki.activity` is this
codebase's audit log and one word must not mean two things.

## Progress and locking

Whether a learner may open a given lesson right now is decided by three
independent rules that compose:

1. **Publication** — learners never receive unpublished material. It is absent,
   not locked: a lock is a promise that something opens later, and a draft
   carries no such promise.
2. **Drip release** — a chapter can carry an absolute `availableFrom` date and a
   `dripDelayDays` offset from the learner's own enrolment. The later of the two
   wins, and the resulting date is _materialized_ per enrolment
   (`chapter_release`) so shortening a delay later cannot retroactively change
   what a learner was already told.
3. **Sequential order** — when `course.sequential` is set, a required lesson that
   is not finished closes everything after it.

All three are resolved on the server by one pure function
(`packages/api/src/lib/course-outline.ts`) and shipped to the client as a boolean
plus a reason code. The UI renders the reason; it does not re-derive the rule.

`enrollment.progress_percent` is denormalized because "my courses" renders a bar
per card and recomputing it per card would be a query per row. Everything that
can move a learner forward goes through `recomputeEnrollmentProgress`. Progress
counts **required** lessons only, so optional material cannot make a finished
course look unfinished. Completion is a one-way door: an author who later adds a
lesson does not un-complete a course somebody already finished.

## Assignments, quizzes and grading

A quiz is its own entity rather than lesson columns, which is what lets the same
quiz be both a practice lesson and a task inside a hand-in.

Answer keys are redacted **structurally**. The learner projection is a separate
branch of a discriminated union with no `isCorrect` key at all, so a handler
that forgets to strip fails output validation instead of leaking. When the key
is revealed is governed by `quiz.answer_reveal` (`never` / `after_attempt` /
`after_pass`), and a timed quiz is clocked from the server-side `started_at`.

Grading appends a `submission_grade` row on every change. A grade is a statement
about a person that can be appealed, so a regrade must not destroy the record of
the previous decision — the same reason `page_revision` exists next to `page`.

`blind_grading` withholds the submitter's identity until a grade is recorded.

## Certificates

A certificate snapshots everything it asserts — recipient name, course title,
organization name, completion date, score — into a JSON column, because it has
to stay readable after the course was renamed, the account was deleted, or the
organization changed its name. The foreign keys are for navigation inside the
app; the snapshot is what the certificate _says_.

It is issued once per enrolment (enforced by a unique index) and is never edited
or deleted, only revoked.

`GET /certificates/verify/{serial}` is the one unauthenticated route in the
product: it is what a third party opens from a printed certificate. It returns
the snapshot facts and the status, and nothing else — no email address, no
internal ids. The serial is generated from `crypto.getRandomValues`, because
knowing it is the only proof of possession the endpoint requires.

Export is the browser's own print-to-PDF; the server has no PDF renderer for
certificates.

## Paid courses

Access control asks exactly one question about money: _does this user hold a
live entitlement for this product?_ That has an answer whether the money arrived
through a card, an invoice, or an administrator handing out seats — so the model
is entitlement-shaped, not processor-shaped:

```
product ──┬── product_price
          ├── purchase      (provider, external_id — filled in by an adapter)
          └── entitlement   (what access control actually reads)
```

**No payment-processor adapter ships in this repository.** Products, prices,
grants and revocations all work today, and `paid` courses are usable with
entitlements granted out of band. Adding a checkout means writing `purchase`
rows and the entitlement they grant; nothing in the access rules changes.

## Files

Course thumbnails, lesson videos and documents, and learner hand-ins live in
`learn.course_asset` — a separate table from `wiki.attachment`, which is
`space_id NOT NULL` and would need a column that is null for most rows. Both use
the same object store; only the key prefix differs (`courses/<courseId>/…`).

Bytes move over `apps/server/src/course-assets.ts` rather than through oRPC,
because multipart bodies and streamed responses do not fit an RPC envelope.
Authorization still lives in the router — the proxy calls it — so the download
path cannot drift from the rules the RPC surface enforces. `Range` requests are
honoured and passed through to the store, so seeking a video does not
re-download the lesson.

A hand-in is reached through the submission it belongs to, never through a flat
file listing: its author and the people who grade it may read it, and nobody
else in the course.

## Audit

Course mutations record rows in the same `wiki.activity` log as the wiki —
"what happened in this organization" has one answer, not one per product. The
table gained a `course_id` sibling to `space_id`, and the action enum gained the
course actions. The enum is mirrored in `packages/api/src/schemas/misc.ts`;
**keep both in sync and generate a migration when adding an action.**
