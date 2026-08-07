import { env } from "@nilovon-wiki/env/server";
import { z } from "zod";

import { publicProcedure } from "../index";

const TAGS = ["Instance"];

/**
 * Facts about the deployment that an unauthenticated browser legitimately needs
 * in order to render the right sign-in screen.
 *
 * Deliberately narrow. The registration *mode* has to be public — the sign-in
 * page cannot otherwise decide whether to offer a "create an account" link, and
 * a person who follows one only to be refused learns the same thing with more
 * frustration. The allowlist of domains is not exposed: it would enumerate an
 * organization's mail domains to anyone who asks, and the refusal message says
 * everything the person needs to hear.
 */
export const instanceRouter = {
  registration: publicProcedure
    .route({
      method: "GET",
      path: "/instance/registration",
      tags: TAGS,
      summary: "How accounts may be created on this instance",
    })
    .output(
      z.object({
        // `open` shows the form to everyone, `invite` shows it but expects an
        // invitation, `closed` hides it.
        mode: z.enum(["open", "invite", "closed"]),
        // Drives the "check your inbox" screen after registering.
        emailVerificationRequired: z.boolean(),
      }),
    )
    .handler(() => ({
      mode: env.SIGNUP_MODE,
      emailVerificationRequired: env.REQUIRE_EMAIL_VERIFICATION,
    })),
};
