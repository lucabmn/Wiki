import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { activityRouter } from "./activity";
import { attachmentRouter } from "./attachment";
import { commentRouter } from "./comment";
import { dashboardRouter } from "./dashboard";
import { linkRouter } from "./link";
import { onboardingRouter } from "./onboarding";
import { pageRouter } from "./page";
import { pageAccessRouter } from "./page-access";
import { searchRouter } from "./search";
import { spaceRouter } from "./space";
import { spaceMemberRouter } from "./space-member";
import { tagRouter } from "./tag";
import { userRouter } from "./user";
import { userStateRouter } from "./user-state";

/**
 * The application API. Each entity lives in its own router module and every
 * procedure carries REST metadata (`method`/`path`/`tags`/`summary`) so the
 * OpenAPI document and the RPC surface stay in sync from one definition.
 */
export const appRouter = {
  health: {
    check: publicProcedure
      .route({ method: "GET", path: "/health", tags: ["Health"], summary: "Liveness probe" })
      .handler(() => "OK"),
  },
  spaces: spaceRouter,
  spaceMembers: spaceMemberRouter,
  pages: pageRouter,
  pageAccess: pageAccessRouter,
  comments: commentRouter,
  tags: tagRouter,
  attachments: attachmentRouter,
  links: linkRouter,
  activity: activityRouter,
  search: searchRouter,
  users: userRouter,
  me: userStateRouter,
  onboarding: onboardingRouter,
  dashboard: dashboardRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
