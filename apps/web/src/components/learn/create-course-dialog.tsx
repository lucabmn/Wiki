import {
  COURSE_VISIBILITY_DESCRIPTION,
  COURSE_VISIBILITY_LABEL,
  ENROLLMENT_POLICY_DESCRIPTION,
  ENROLLMENT_POLICY_LABEL,
} from "@/lib/learn-labels";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Label } from "@nilovon-wiki/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nilovon-wiki/ui/components/select";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

type Visibility = "private" | "organization" | "public";
type Policy = "open" | "request" | "invite" | "paid";

/**
 * Creates a course and takes the author straight into the builder.
 *
 * A new course is deliberately private and invite-only: it starts as a draft
 * nobody else can see, and going live is a separate, explicit act — the same
 * shape as publishing a page.
 */
export function CreateCourseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("organization");
  const [policy, setPolicy] = useState<Policy>("open");
  const invalidateCourses = useInvalidate(orpc.learn.courses.list.key());

  const create = useMutation(
    orpc.learn.courses.create.mutationOptions({
      onSuccess: (course) => {
        invalidateCourses();
        setTitle("");
        setTagline("");
        onOpenChange(false);
        void navigate({ to: "/learn/courses/$slug/edit", params: { slug: course.slug } });
      },
      onError: toastError,
    }),
  );

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate({
      title: trimmed,
      tagline: tagline.trim() || null,
      visibility,
      enrollmentPolicy: policy,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuer Kurs</DialogTitle>
          <DialogDescription>
            Der Kurs startet als Entwurf. Erst beim Veröffentlichen wird er sichtbar.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="course-title">Titel</Label>
            <Input
              id="course-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="z. B. Onboarding für neue Kolleg:innen"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-tagline">Kurzbeschreibung</Label>
            <Textarea
              id="course-tagline"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              placeholder="Ein Satz, der im Katalog steht."
              maxLength={300}
              rows={2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="course-visibility">Sichtbarkeit</Label>
              <Select
                value={visibility}
                onValueChange={(value) => setVisibility(value as Visibility)}
              >
                <SelectTrigger id="course-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["private", "organization", "public"] as Visibility[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {COURSE_VISIBILITY_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {COURSE_VISIBILITY_DESCRIPTION[visibility]}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="course-policy">Einschreibung</Label>
              <Select value={policy} onValueChange={(value) => setPolicy(value as Policy)}>
                <SelectTrigger id="course-policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["open", "request", "invite", "paid"] as Policy[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {ENROLLMENT_POLICY_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {ENROLLMENT_POLICY_DESCRIPTION[policy]}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending ? "Wird erstellt…" : "Kurs erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
