import { ENROLLABILITY_REASON_LABEL } from "@/lib/learn-labels";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

type Enrollability = {
  allowed: boolean;
  reason: keyof typeof ENROLLABILITY_REASON_LABEL | string;
};

/**
 * The one action a course landing page exists for.
 *
 * Both the label and the disabled state come from the server's `enrollability`
 * verdict, not from re-deriving the policy here. That is the whole reason the
 * API answers with a reason code instead of a bare 403: "Nur auf Einladung des
 * Kursteams" is an answer, "Zugriff verweigert" is not.
 */
export function EnrollButton({
  course,
}: {
  course: { id: string; slug: string; enrollability: Enrollability };
}) {
  const invalidateCourse = useInvalidate(orpc.learn.courses.key());
  const invalidateEnrollments = useInvalidate(orpc.learn.enrollments.key());

  const enroll = useMutation(
    orpc.learn.enrollments.enroll.mutationOptions({
      onSuccess: (enrollment) => {
        invalidateCourse();
        invalidateEnrollments();
        toast.success(
          enrollment.status === "pending"
            ? "Anfrage gesendet — das Kursteam gibt sie frei."
            : "Du bist eingeschrieben.",
        );
      },
      onError: toastError,
    }),
  );

  const { allowed, reason } = course.enrollability;
  const label = ENROLLABILITY_REASON_LABEL[reason] ?? "Einschreiben";

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={!allowed || enroll.isPending}
        onClick={() => enroll.mutate({ courseId: course.id })}
      >
        {enroll.isPending ? "Einen Moment…" : label}
      </Button>
      {!allowed && reason !== "already_enrolled" && (
        <p className="text-muted-foreground text-xs">{ENROLLABILITY_REASON_LABEL[reason]}</p>
      )}
    </div>
  );
}
