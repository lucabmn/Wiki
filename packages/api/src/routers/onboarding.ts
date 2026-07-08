import { eq } from "drizzle-orm";
import { z } from "zod";

import { page, space, spaceMember } from "@nilovon-wiki/db/schema/index";

import { requireActiveOrg, requireOrgPermission } from "../index";
import { recordActivity } from "../lib/activity";
import { generateKeyBetween } from "../lib/fractional";
import { firstRow } from "../lib/rows";

const TAGS = ["Onboarding"];

/**
 * The starter content offered during onboarding. A small, self-explanatory wiki
 * (three public spaces) so a fresh organization isn't an empty shell. Seeded
 * only when the user opts in.
 */
const SAMPLE_SPACES: ReadonlyArray<{
  slug: string;
  name: string;
  icon: string;
  color: string;
  pages: ReadonlyArray<{ slug: string; title: string; text: string }>;
}> = [
  {
    slug: "onboarding",
    name: "Onboarding",
    icon: "📚",
    color: "#6366f1",
    pages: [
      {
        slug: "willkommen",
        title: "Willkommen im Team",
        text: "Schön, dass du da bist! Diese Seite gibt dir einen Überblick über deine ersten Tage und die wichtigsten Anlaufstellen.",
      },
      {
        slug: "erste-schritte",
        title: "Erste Schritte",
        text: "Deine Checkliste für die erste Woche: Zugänge einrichten, Team kennenlernen, erste Aufgaben übernehmen.",
      },
      {
        slug: "it-setup",
        title: "IT-Setup & Zugänge",
        text: "So richtest du Laptop, E-Mail, VPN und die wichtigsten Tools ein. Bei Problemen hilft dir das IT-Team.",
      },
    ],
  },
  {
    slug: "prozesse",
    name: "Prozesse",
    icon: "⚙️",
    color: "#0ea5e9",
    pages: [
      {
        slug: "urlaub",
        title: "Urlaub & Abwesenheit",
        text: "Wie du Urlaub beantragst, wie viele Tage dir zustehen und was bei Krankheit zu tun ist.",
      },
      {
        slug: "spesen",
        title: "Spesenabrechnung",
        text: "Reisekosten und Auslagen korrekt einreichen – inklusive Fristen und benötigter Belege.",
      },
      {
        slug: "code-review",
        title: "Code-Review-Richtlinien",
        text: "Unsere Standards für Pull Requests: Umfang, Review-Etikette und wann ein zweites Paar Augen nötig ist.",
      },
    ],
  },
  {
    slug: "unternehmen",
    name: "Unternehmen",
    icon: "🏢",
    color: "#10b981",
    pages: [
      {
        slug: "leitbild",
        title: "Leitbild & Werte",
        text: "Wofür wir stehen und wie wir zusammenarbeiten wollen – unsere Mission und Grundwerte.",
      },
      {
        slug: "organigramm",
        title: "Organigramm",
        text: "Wer ist wofür verantwortlich? Ein Überblick über Teams, Rollen und Ansprechpartner.",
      },
      {
        slug: "benefits",
        title: "Benefits & Vergünstigungen",
        text: "Von flexiblen Arbeitszeiten bis zur betrieblichen Altersvorsorge – deine Zusatzleistungen im Überblick.",
      },
    ],
  },
];

export const onboardingRouter = {
  seedSampleData: requireOrgPermission({ space: ["create"] })
    .route({
      method: "POST",
      path: "/onboarding/sample-data",
      tags: TAGS,
      summary: "Seed starter spaces and pages into the active organization",
    })
    .input(z.object({}))
    .output(z.object({ spaces: z.number().int(), pages: z.number().int() }))
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;

      return context.db.transaction(async (tx) => {
        // Idempotency guard: never seed an organization that already has content.
        const existing = await tx.query.space.findFirst({
          where: eq(space.organizationId, organizationId),
          columns: { id: true },
        });
        if (existing) {
          return { spaces: 0, pages: 0 };
        }

        let spaceCount = 0;
        let pageCount = 0;

        for (const sample of SAMPLE_SPACES) {
          const spaceRow = firstRow(
            await tx
              .insert(space)
              .values({
                organizationId,
                slug: sample.slug,
                name: sample.name,
                icon: sample.icon,
                color: sample.color,
                visibility: "public",
                createdBy: userId,
              })
              .returning(),
          );
          await tx.insert(spaceMember).values({
            spaceId: spaceRow.id,
            subject: "user",
            userId,
            role: "admin",
          });
          await recordActivity(tx, {
            organizationId,
            action: "space.created",
            actorId: userId,
            spaceId: spaceRow.id,
            metadata: { name: spaceRow.name },
          });
          spaceCount++;

          let position: string | null = null;
          for (const p of sample.pages) {
            position = generateKeyBetween(position, null);
            const pageRow = firstRow(
              await tx
                .insert(page)
                .values({
                  spaceId: spaceRow.id,
                  slug: p.slug,
                  title: p.title,
                  textContent: p.text,
                  status: "published",
                  position,
                  publishedAt: new Date(),
                  createdBy: userId,
                  lastEditedBy: userId,
                })
                .returning(),
            );
            await recordActivity(tx, {
              organizationId,
              action: "page.created",
              actorId: userId,
              spaceId: spaceRow.id,
              pageId: pageRow.id,
              metadata: { title: pageRow.title },
            });
            pageCount++;
          }
        }

        return { spaces: spaceCount, pages: pageCount };
      });
    }),
};
