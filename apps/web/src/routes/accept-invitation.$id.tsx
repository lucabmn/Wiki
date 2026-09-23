import { Button } from "@nilovon-wiki/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import AuthLayout from "@/components/layouts/auth-layout";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { ROLE_LABEL } from "@/lib/labels";
import { splitRoles } from "@/lib/roles";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/accept-invitation/$id")({
  head: () => pageTitle("Einladung"),
  component: RouteComponent,
});

type Invitation = NonNullable<
  Awaited<ReturnType<typeof authClient.organization.getInvitation>>["data"]
>;

type InvitationLookup =
  | { kind: "ok"; invitation: Invitation }
  | { kind: "wrong-account" }
  | { kind: "invalid" };

/**
 * Landing page for the link in an invitation mail. Deliberately outside the
 * `_auth` guard: an invited person usually has no account yet, so the route
 * must render for signed-out visitors and send them to register first.
 *
 * Accepting is an explicit click, never an effect on mount: mail clients and
 * link scanners prefetch URLs, and a silent auto-accept would let a scanner
 * join the organization on the recipient's behalf.
 */
function RouteComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  // better-auth only answers `getInvitation` for a signed-in recipient: signed
  // out it is a 401, signed in as somebody else a 403. Both are expected states
  // of this page, not errors, so they are returned rather than thrown (which
  // would also fire the global error toast).
  const { data: lookup, isPending } = useQuery({
    queryKey: ["invitation", id, session?.user.id],
    queryFn: async (): Promise<InvitationLookup> => {
      const { data, error } = await authClient.organization.getInvitation({
        query: { id },
      });
      if (error) return { kind: error.status === 403 ? "wrong-account" : "invalid" };
      return { kind: "ok", invitation: data };
    },
    enabled: Boolean(session),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.acceptInvitation({ invitationId: id });
      // better-auth's messages are English; keep the toast German.
      if (error) throw new Error("Die Einladung konnte nicht angenommen werden.");
    },
    onSuccess: () => {
      toast.success("Einladung angenommen");
      // Accepting switches the active organization; nothing cached for the
      // previous one may leak into the next screen.
      queryClient.clear();
      navigate({ to: "/" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.rejectInvitation({ invitationId: id });
      if (error) throw new Error("Die Einladung konnte nicht abgelehnt werden.");
    },
    onSuccess: () => {
      toast.success("Einladung abgelehnt");
      // Still signed in, so home rather than the login form; without any
      // organization the `_auth` guard forwards to onboarding.
      navigate({ to: "/" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const signOut = useMutation({
    mutationFn: () => authClient.signOut(),
    onSuccess: () => {
      queryClient.clear();
      navigate({ to: "/auth/login" });
    },
  });

  if (sessionPending || (session && isPending)) return <Loader />;

  // Signed out: the invitation cannot be read yet (see above), so all we can do
  // is point at the two ways in.
  if (!session) {
    return (
      <AuthLayout
        title="Du wurdest eingeladen"
        subtitle="Melde dich mit der eingeladenen E-Mail-Adresse an."
        footer={
          <Link to="/auth/login" className="font-semibold underline-offset-4 hover:underline">
            Ich habe schon ein Konto
          </Link>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Erstelle zuerst ein Konto mit der Adresse, an die die Einladung ging, und öffne dann den
            Link aus der E-Mail erneut.
          </p>
          <Button
            size="lg"
            className="w-full"
            nativeButton={false}
            render={<Link to="/auth/register" />}
          >
            Konto erstellen
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // Signed in as somebody other than the invitee: better-auth binds acceptance
  // to the session's email, so the only way forward is another account.
  if (lookup?.kind === "wrong-account") {
    return (
      <AuthLayout
        title="Falsches Konto"
        subtitle={`Du bist als ${session.user.email} angemeldet.`}
        footer={null}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Diese Einladung gilt für eine andere E-Mail-Adresse. Melde dich mit dieser Adresse an
            und öffne den Link aus der E-Mail danach erneut.
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            {signOut.isPending ? "Wird abgemeldet …" : "Abmelden"}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (lookup?.kind !== "ok") {
    return (
      <AuthLayout
        title="Einladung ungültig"
        subtitle="Dieser Link führt zu keiner offenen Einladung."
        footer={
          <Link to="/" className="font-semibold underline-offset-4 hover:underline">
            Zur Startseite
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Die Einladung wurde bereits angenommen, abgelehnt oder ist abgelaufen. Bitte den Absender
          um eine neue Einladung.
        </p>
      </AuthLayout>
    );
  }

  const { invitation } = lookup;
  const roleLabel = splitRoles(invitation.role)
    .map((role) => ROLE_LABEL[role] ?? role)
    .join(", ");

  return (
    <AuthLayout
      title={`Einladung zu ${invitation.organizationName}`}
      subtitle={`Du wurdest als ${roleLabel} eingeladen.`}
      footer={null}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Nach dem Annehmen siehst du alle Spaces und Seiten, für die du berechtigt bist.
        </p>
        <div className="flex gap-2">
          <Button
            size="lg"
            className="flex-1"
            disabled={accept.isPending || reject.isPending}
            onClick={() => accept.mutate()}
          >
            {accept.isPending ? "Wird angenommen …" : "Annehmen"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={accept.isPending || reject.isPending}
            onClick={() => reject.mutate()}
          >
            {reject.isPending ? "Wird abgelehnt …" : "Ablehnen"}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
