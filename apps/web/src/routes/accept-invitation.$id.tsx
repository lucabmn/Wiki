import { Button } from "@nilovon-wiki/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import AuthLayout from "@/components/layouts/auth-layout";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/accept-invitation/$id")({
  component: RouteComponent,
});

/**
 * Landing page for the link in an invitation mail. Deliberately outside the
 * `_auth` guard: an invited person usually has no account yet, so the route
 * must render for signed-out visitors and send them to register first — with
 * the invitation id preserved so they land back here afterwards.
 *
 * Accepting is an explicit click, never an effect on mount: mail clients and
 * link scanners prefetch URLs, and a silent auto-accept would let a scanner
 * join the organization on the recipient's behalf.
 */
function RouteComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const { data: invitation, isPending } = useQuery({
    queryKey: ["invitation", id],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({
        query: { id },
      });
      if (error) throw new Error(error.message ?? "Einladung nicht gefunden");
      return data;
    },
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.acceptInvitation({ invitationId: id });
      if (error) throw new Error(error.message ?? "Annehmen fehlgeschlagen");
    },
    onSuccess: () => {
      toast.success("Einladung angenommen");
      navigate({ to: "/" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.rejectInvitation({ invitationId: id });
      if (error) throw new Error(error.message ?? "Ablehnen fehlgeschlagen");
    },
    onSuccess: () => {
      toast.success("Einladung abgelehnt");
      navigate({ to: "/auth/login" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (sessionPending || isPending) return <Loader />;

  if (!invitation) {
    return (
      <AuthLayout
        title="Einladung ungültig"
        subtitle="Dieser Link führt zu keiner offenen Einladung."
        footer={
          <Link to="/auth/login" className="font-semibold underline-offset-4 hover:underline">
            Zur Anmeldung
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

  // Signed out, or signed in as somebody other than the invitee: better-auth
  // binds acceptance to the session's email, so accepting would fail.
  const wrongAccount = session != null && session.user.email !== invitation.email;
  if (!session || wrongAccount) {
    return (
      <AuthLayout
        title={`Einladung zu ${invitation.organizationName}`}
        subtitle={`Die Einladung gilt für ${invitation.email}.`}
        footer={
          <Link to="/auth/login" className="font-semibold underline-offset-4 hover:underline">
            Ich habe schon ein Konto
          </Link>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {wrongAccount
              ? `Du bist als ${session?.user.email} angemeldet. Melde dich mit ${invitation.email} an, um die Einladung anzunehmen.`
              : "Erstelle zuerst ein Konto mit dieser Adresse und öffne dann den Link aus der E-Mail erneut."}
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

  return (
    <AuthLayout
      title={`Einladung zu ${invitation.organizationName}`}
      subtitle={`Du wurdest als ${invitation.role} eingeladen.`}
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
            Ablehnen
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
