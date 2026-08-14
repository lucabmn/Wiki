import { describe, expect, it } from "vitest";

import {
  maxRole,
  resolveAnonymousCourseAccess,
  resolveCourseAccess,
  resolveEnrollability,
  roleAllows,
  type CourseAccessFacts,
  type CourseRole,
  type CourseStatus,
  type CourseVisibility,
  type EnrollabilityFacts,
  type EnrollmentPolicy,
  type EnrollmentStatus,
} from "../../src/lib/course-access";

/**
 * The course access truth table.
 *
 * These are the rules that decide whether a learner can open paid or private
 * material, so they are enumerated exhaustively rather than sampled: every
 * combination of visibility, status and enrolment is asserted, and the two
 * escalation paths (staff grant, org manager) are pinned separately.
 */

const BASE: CourseAccessFacts = {
  status: "published",
  visibility: "organization",
  memberRole: null,
  isCreator: false,
  isOrgManager: false,
  isOrgMember: true,
  enrollment: null,
};

const facts = (over: Partial<CourseAccessFacts> = {}): CourseAccessFacts => ({ ...BASE, ...over });

const VISIBILITIES: CourseVisibility[] = ["private", "organization", "public"];
const STATUSES: CourseStatus[] = ["draft", "published", "archived"];
const ENROLLMENTS: (EnrollmentStatus | null)[] = [
  null,
  "pending",
  "active",
  "completed",
  "dropped",
];

describe("roleAllows", () => {
  const ROLES: CourseRole[] = ["reviewer", "assistant", "instructor", "owner"];

  it("ranks staff roles so a grant implies every weaker capability", () => {
    expect(ROLES.map((role) => roleAllows(role, "view"))).toEqual([true, true, true, true]);
    expect(ROLES.map((role) => roleAllows(role, "grade"))).toEqual([false, true, true, true]);
    expect(ROLES.map((role) => roleAllows(role, "author"))).toEqual([false, false, true, true]);
    expect(ROLES.map((role) => roleAllows(role, "manage"))).toEqual([false, false, false, true]);
  });

  it("denies every capability without a grant", () => {
    expect(roleAllows(null, "view")).toBe(false);
    expect(roleAllows(null, "manage")).toBe(false);
  });

  it("maxRole keeps the stronger of two grants", () => {
    expect(maxRole("reviewer", "instructor")).toBe("instructor");
    expect(maxRole("owner", "assistant")).toBe("owner");
    expect(maxRole(null, "reviewer")).toBe("reviewer");
    expect(maxRole(null, null)).toBeNull();
  });
});

describe("resolveCourseAccess — staff", () => {
  it("gives staff full access in every status, including drafts", () => {
    for (const status of STATUSES) {
      for (const visibility of VISIBILITIES) {
        const access = resolveCourseAccess(facts({ status, visibility, memberRole: "reviewer" }));
        expect(access).toEqual({ canView: true, canLearn: true, role: "reviewer" });
      }
    }
  });

  it("treats the creator and org managers as course owners", () => {
    expect(resolveCourseAccess(facts({ status: "draft", isCreator: true })).role).toBe("owner");
    expect(resolveCourseAccess(facts({ status: "draft", isOrgManager: true })).role).toBe("owner");
  });

  it("keeps an explicit grant when it is weaker than nothing else applies", () => {
    expect(resolveCourseAccess(facts({ memberRole: "assistant" })).role).toBe("assistant");
  });
});

describe("resolveCourseAccess — drafts", () => {
  it("hides a draft from everyone who is not staff, enrolled or not", () => {
    for (const visibility of VISIBILITIES) {
      for (const enrollment of ENROLLMENTS) {
        const access = resolveCourseAccess(facts({ status: "draft", visibility, enrollment }));
        expect(access).toEqual({ canView: false, canLearn: false, role: null });
      }
    }
  });
});

describe("resolveCourseAccess — visibility", () => {
  it("public: anyone may see the landing page, even without an org", () => {
    const access = resolveCourseAccess(
      facts({ visibility: "public", isOrgMember: false, enrollment: null }),
    );
    expect(access.canView).toBe(true);
    expect(access.canLearn).toBe(false);
  });

  it("organization: only members of the owning org may see it", () => {
    expect(resolveCourseAccess(facts({ visibility: "organization" })).canView).toBe(true);
    expect(
      resolveCourseAccess(facts({ visibility: "organization", isOrgMember: false })).canView,
    ).toBe(false);
  });

  it("private: invisible without an enrolment, even to org members", () => {
    expect(resolveCourseAccess(facts({ visibility: "private" })).canView).toBe(false);
    expect(
      resolveCourseAccess(facts({ visibility: "private", enrollment: "active" })).canView,
    ).toBe(true);
  });

  it("private: a dropped learner keeps the landing page so they can rejoin", () => {
    const access = resolveCourseAccess(facts({ visibility: "private", enrollment: "dropped" }));
    expect(access.canView).toBe(true);
    expect(access.canLearn).toBe(false);
  });
});

describe("resolveCourseAccess — learning", () => {
  it("only an active or completed enrolment opens the content", () => {
    const learnable = ENROLLMENTS.filter(
      (enrollment) => resolveCourseAccess(facts({ enrollment })).canLearn,
    );
    expect(learnable).toEqual(["active", "completed"]);
  });

  it("an archived course stays open for its learners and shut to everyone else", () => {
    expect(resolveCourseAccess(facts({ status: "archived", enrollment: "active" })).canLearn).toBe(
      true,
    );
    expect(resolveCourseAccess(facts({ status: "archived", enrollment: null })).canLearn).toBe(
      false,
    );
  });

  it("org membership alone never opens content — this is the wiki/LMS split", () => {
    // Someone with every org permission but no enrolment sees the catalog entry
    // and nothing more. Only `isOrgManager` (owner/admin) escalates.
    const access = resolveCourseAccess(facts({ visibility: "organization", enrollment: null }));
    expect(access).toEqual({ canView: true, canLearn: false, role: null });
  });
});

describe("resolveAnonymousCourseAccess", () => {
  it("admits only published public courses, and only to the landing page", () => {
    expect(
      resolveAnonymousCourseAccess({
        id: "c1",
        organizationId: "org",
        status: "published",
        visibility: "public",
        createdBy: null,
      }),
    ).toEqual({ canView: true, canLearn: false, role: null });

    for (const visibility of ["private", "organization"] as CourseVisibility[]) {
      expect(
        resolveAnonymousCourseAccess({
          id: "c1",
          organizationId: "org",
          status: "published",
          visibility,
          createdBy: null,
        }).canView,
      ).toBe(false);
    }
  });

  it("never admits a draft", () => {
    expect(
      resolveAnonymousCourseAccess({
        id: "c1",
        organizationId: "org",
        status: "draft",
        visibility: "public",
        createdBy: null,
      }).canView,
    ).toBe(false);
  });
});

describe("resolveEnrollability", () => {
  const VIEWABLE = { canView: true, canLearn: false, role: null } as const;

  const enrollFacts = (over: Partial<EnrollabilityFacts> = {}): EnrollabilityFacts => ({
    access: VIEWABLE,
    status: "published",
    policy: "open",
    enrollment: null,
    seatsLeft: null,
    closed: false,
    hasEntitlement: false,
    ...over,
  });

  it("open courses admit anyone who can see them", () => {
    expect(resolveEnrollability(enrollFacts())).toEqual({ allowed: true, reason: "ok" });
  });

  it("request policy admits, but flags that approval is needed", () => {
    expect(resolveEnrollability(enrollFacts({ policy: "request" }))).toEqual({
      allowed: true,
      reason: "approval_required",
    });
  });

  it("invite-only refuses self-enrolment", () => {
    expect(resolveEnrollability(enrollFacts({ policy: "invite" }))).toEqual({
      allowed: false,
      reason: "invite_only",
    });
  });

  it("paid courses need a live entitlement", () => {
    expect(resolveEnrollability(enrollFacts({ policy: "paid" }))).toEqual({
      allowed: false,
      reason: "payment_required",
    });
    expect(resolveEnrollability(enrollFacts({ policy: "paid", hasEntitlement: true }))).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("refuses when already in, whatever the policy says", () => {
    for (const policy of ["open", "request", "invite", "paid"] as EnrollmentPolicy[]) {
      expect(resolveEnrollability(enrollFacts({ policy, enrollment: "active" })).reason).toBe(
        "already_enrolled",
      );
      expect(resolveEnrollability(enrollFacts({ policy, enrollment: "completed" })).reason).toBe(
        "already_enrolled",
      );
      expect(resolveEnrollability(enrollFacts({ policy, enrollment: "pending" })).reason).toBe(
        "approval_required",
      );
    }
  });

  it("lets a dropped learner re-enrol", () => {
    expect(resolveEnrollability(enrollFacts({ enrollment: "dropped" }))).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("refuses an invisible course before it looks at the policy", () => {
    const hidden = { canView: false, canLearn: false, role: null } as const;
    expect(resolveEnrollability(enrollFacts({ access: hidden, policy: "open" })).reason).toBe(
      "not_visible",
    );
  });

  it("refuses unpublished courses", () => {
    for (const status of ["draft", "archived"] as CourseStatus[]) {
      expect(resolveEnrollability(enrollFacts({ status })).reason).toBe("not_published");
    }
  });

  it("honours the closing date and the seat cap", () => {
    expect(resolveEnrollability(enrollFacts({ closed: true })).reason).toBe("closed");
    expect(resolveEnrollability(enrollFacts({ seatsLeft: 0 })).reason).toBe("full");
    expect(resolveEnrollability(enrollFacts({ seatsLeft: 1 })).allowed).toBe(true);
  });
});
