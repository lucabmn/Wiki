import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FileStack,
  Loader2,
  Rocket,
  Sparkles,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/auth/onboarding")({
  ssr: false,
  async beforeLoad() {
    const session = await authClient.getSession();
    if (!session.data?.session) {
      throw redirect({
        to: "/auth/login",
      });
    }
  },
  component: OnboardingPage,
});

// --- Domain helpers --------------------------------------------------------

const orgSchema = z.object({
  name: z.string().min(2, "Mindestens 2 Zeichen").max(120, "Höchstens 120 Zeichen"),
  slug: z
    .string()
    .min(2, "Mindestens 2 Zeichen")
    .max(60, "Höchstens 60 Zeichen")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Nur Kleinbuchstaben, Zahlen und Bindestriche"),
});

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Creates the org, retrying once with a suffix if the slug is already taken. */
async function createOrganization(name: string, slug: string) {
  const first = await authClient.organization.create({ name, slug });
  if (!first.error) return first.data;

  const fallbackSlug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const retry = await authClient.organization.create({ name, slug: fallbackSlug });
  if (retry.error) {
    throw new Error(retry.error.message ?? "Organisation konnte nicht erstellt werden");
  }
  return retry.data;
}

// --- Steps -----------------------------------------------------------------

const STEPS = [
  { title: "Organisation", description: "Name und Kürzel", icon: Building2 },
  { title: "Einrichtung", description: "Startinhalte", icon: Sparkles },
  { title: "Los geht's", description: "Bestätigen", icon: Rocket },
] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "active" : "upcoming";
        const Icon = step.icon;
        return (
          <li key={step.title} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm transition-colors",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "active" && "border-primary text-primary",
                  state === "upcoming" && "border-border text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-4" /> : <Icon className="size-4" />}
              </div>
              <div className="hidden sm:block">
                <div
                  className={cn(
                    "text-[13px] font-medium leading-tight",
                    state === "upcoming" && "text-muted-foreground",
                  )}
                >
                  {step.title}
                </div>
                <div className="text-[11px] leading-tight text-muted-foreground">
                  {step.description}
                </div>
              </div>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 transition-colors",
                  index < current ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function OnboardingPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [useSampleData, setUseSampleData] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Survives a partial failure: if the org was created but activation/seeding
  // failed, a retry resumes with this org instead of creating a duplicate.
  const createdOrgId = useRef<string | null>(null);

  const orgResult = orgSchema.safeParse({ name, slug });
  const fieldError = (field: "name" | "slug") =>
    orgResult.success
      ? undefined
      : orgResult.error.issues.find((i) => i.path[0] === field)?.message;

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  async function handleFinish() {
    setSubmitting(true);
    try {
      if (!createdOrgId.current) {
        setStatus("Organisation wird erstellt …");
        const org = await createOrganization(name.trim(), slug);
        createdOrgId.current = org.id;
      }

      setStatus("Organisation wird aktiviert …");
      await authClient.organization.setActive({ organizationId: createdOrgId.current });

      if (useSampleData) {
        setStatus("Beispielinhalte werden angelegt …");
        await client.onboarding.seedSampleData({});
      }

      toast.success("Willkommen! Deine Wiki ist bereit.");
      await navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Etwas ist schiefgelaufen");
      setSubmitting(false);
      setStatus(null);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Richte deinen Wissens-Hub ein</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            In wenigen Schritten steht deine Organisation.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-6 p-6">
            <Stepper current={step} />

            {step === 0 && (
              <div className="space-y-4">
                <Field data-invalid={Boolean(name && fieldError("name"))}>
                  <FieldLabel htmlFor="org-name">Name der Organisation</FieldLabel>
                  <Input
                    id="org-name"
                    autoFocus
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="z. B. Nordwind GmbH"
                    aria-invalid={Boolean(name && fieldError("name"))}
                  />
                  {name && fieldError("name") && (
                    <FieldError errors={[{ message: fieldError("name")! }]} />
                  )}
                </Field>

                <Field data-invalid={Boolean(slug && fieldError("slug"))}>
                  <FieldLabel htmlFor="org-slug">Kürzel (URL)</FieldLabel>
                  <Input
                    id="org-slug"
                    value={slug}
                    onChange={(e) => {
                      setSlug(slugify(e.target.value));
                      setSlugEdited(true);
                    }}
                    placeholder="nordwind"
                    aria-invalid={Boolean(slug && fieldError("slug"))}
                  />
                  {slug && fieldError("slug") ? (
                    <FieldError errors={[{ message: fieldError("slug")! }]} />
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      Eindeutiges Kürzel für Links und Verweise.
                    </p>
                  )}
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setUseSampleData((v) => !v)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                    useSampleData ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                  )}
                >
                  <Checkbox
                    checked={useSampleData}
                    onCheckedChange={(checked) => setUseSampleData(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileStack className="size-4 text-primary" />
                      Beispielinhalte hinzufügen
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      Legt drei fertige Spaces an – <strong>Onboarding</strong>,{" "}
                      <strong>Prozesse</strong> und <strong>Unternehmen</strong> – mit insgesamt
                      neun Beispielseiten. So siehst du sofort, wie alles zusammenspielt.
                    </p>
                  </div>
                </button>
                <p className="text-[13px] text-muted-foreground">
                  {useSampleData
                    ? "Du kannst die Beispielinhalte jederzeit bearbeiten oder löschen."
                    : "Du startest mit einer leeren Organisation und legst deine Spaces selbst an."}
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <SummaryRow label="Organisation" value={name.trim()} />
                <SummaryRow label="Kürzel" value={slug} />
                <SummaryRow
                  label="Startinhalte"
                  value={useSampleData ? "Beispiel-Wiki (3 Spaces, 9 Seiten)" : "Leer starten"}
                />
                {status && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {status}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={goBack}
                disabled={step === 0 || submitting}
                className={cn(step === 0 && "invisible")}
              >
                <ArrowLeft /> Zurück
              </Button>

              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={goNext} disabled={step === 0 && !orgResult.success}>
                  Weiter <ArrowRight />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleFinish}
                  disabled={submitting || !orgResult.success}
                >
                  {submitting ? <Loader2 className="animate-spin" /> : <Rocket />}
                  {submitting ? "Wird erstellt …" : "Organisation erstellen"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
