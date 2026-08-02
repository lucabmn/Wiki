import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { MailCheck, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { toastError } from "@/lib/query";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { Avatar, AvatarFallback, AvatarImage } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";

export const Route = createFileRoute("/_auth/settings/profile")({
  component: ProfileSettings,
});

const emailSchema = z.string().email("Bitte eine gültige E-Mail-Adresse eingeben");

function ProfileSettings() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <div className="space-y-8">
      <ProfileForm name={user?.name ?? ""} image={user?.image ?? ""} />
      <EmailForm email={user?.email ?? ""} verified={user?.emailVerified ?? false} />
    </div>
  );
}

function ProfileForm({ name, image }: { name: string; image: string }) {
  const router = useRouter();
  const [nextName, setNextName] = useState(name);
  const [nextImage, setNextImage] = useState(image);

  // The session arrives after the first paint (`ssr: false` on the layout), so
  // seed the inputs again once it lands instead of leaving them empty.
  useEffect(() => setNextName(name), [name]);
  useEffect(() => setNextImage(image), [image]);

  const save = useMutation({
    mutationFn: async () => {
      const result = await authClient.updateUser({
        name: nextName.trim(),
        // An empty field means "no avatar" — send null, not "".
        image: nextImage.trim() === "" ? null : nextImage.trim(),
      });
      if (result.error) throw new Error(result.error.message ?? "Speichern fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      // The sidebar and every member list read the user off SSR route context,
      // not the session query — invalidate the router so they repaint too.
      await router.invalidate();
      toast.success("Profil gespeichert");
    },
    onError: toastError,
  });

  const dirty = nextName.trim() !== name || nextImage.trim() !== image;
  const valid = nextName.trim().length > 0;

  return (
    <SettingsSection
      title="Profil"
      description="Name und Bild, die andere Mitglieder neben deinen Beiträgen sehen."
    >
      <SettingsCard>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && valid) save.mutate();
          }}
        >
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              {nextImage.trim() ? <AvatarImage src={nextImage.trim()} alt="" /> : null}
              <AvatarFallback>{initials(nextName || "?")}</AvatarFallback>
            </Avatar>
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="profile-image">Bild-URL</FieldLabel>
              <Input
                id="profile-image"
                type="url"
                value={nextImage}
                onChange={(event) => setNextImage(event.target.value)}
                placeholder="https://…/avatar.png"
              />
              <FieldDescription>
                Ein öffentlich erreichbarer Link. Leer lassen, um die Initialen zu zeigen.
              </FieldDescription>
            </Field>
          </div>

          <Field data-invalid={!valid ? true : undefined}>
            <FieldLabel htmlFor="profile-name">Anzeigename</FieldLabel>
            <Input
              id="profile-name"
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
              aria-invalid={!valid ? true : undefined}
            />
            {!valid ? <FieldError>Der Name darf nicht leer sein.</FieldError> : null}
          </Field>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!dirty || !valid || save.isPending}>
              {save.isPending ? "Speichern …" : "Speichern"}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}

function EmailForm({ email, verified }: { email: string; verified: boolean }) {
  const router = useRouter();
  const [nextEmail, setNextEmail] = useState(email);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setNextEmail(email), [email]);

  const change = useMutation({
    mutationFn: async (newEmail: string) => {
      const result = await authClient.changeEmail({ newEmail, callbackURL: "/settings/profile" });
      if (result.error) throw new Error(result.error.message ?? "Änderung fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await router.invalidate();
      // Which of the two paths ran depends on whether the *current* address was
      // verified, and the server does not say — so word it for both.
      toast.success(
        verified
          ? "Bestätigungs-Mail an deine aktuelle Adresse geschickt"
          : "E-Mail-Adresse geändert",
      );
    },
    onError: toastError,
  });

  const resend = useMutation({
    mutationFn: async () => {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/settings/profile",
      });
      if (result.error) throw new Error(result.error.message ?? "Versand fehlgeschlagen");
      return result.data;
    },
    onSuccess: () => toast.success("Bestätigungs-Mail verschickt"),
    onError: toastError,
  });

  const submit = () => {
    const parsed = emailSchema.safeParse(nextEmail.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ungültige E-Mail");
      return;
    }
    setError(null);
    change.mutate(parsed.data);
  };

  return (
    <SettingsSection
      title="E-Mail-Adresse"
      description="Deine Anmelde-Adresse. Sie erhält Einladungen und Benachrichtigungen."
    >
      <SettingsCard>
        <div className="flex items-center gap-2">
          {verified ? (
            <Badge variant="secondary">
              <MailCheck className="size-3" /> Bestätigt
            </Badge>
          ) : (
            <>
              <Badge variant="outline">
                <MailWarning className="size-3" /> Nicht bestätigt
              </Badge>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={resend.isPending || !email}
                onClick={() => resend.mutate()}
              >
                {resend.isPending ? "Wird verschickt …" : "Bestätigung erneut senden"}
              </Button>
            </>
          )}
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="profile-email">Neue Adresse</FieldLabel>
            <Input
              id="profile-email"
              type="email"
              value={nextEmail}
              onChange={(event) => {
                setNextEmail(event.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <FieldDescription>
                {verified
                  ? "Die Änderung muss über einen Link an deine aktuelle Adresse bestätigt werden."
                  : "Da deine Adresse noch nicht bestätigt ist, greift die Änderung sofort."}
              </FieldDescription>
            )}
          </Field>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={change.isPending || nextEmail.trim() === email || !nextEmail.trim()}
            >
              {change.isPending ? "Ändern …" : "Adresse ändern"}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}
