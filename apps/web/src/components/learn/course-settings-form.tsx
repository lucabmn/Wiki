import { LearnRichText, toastLearnError } from "@/components/learn/lesson-editor";
import {
  COURSE_LEVEL_LABEL,
  COURSE_VISIBILITY_DESCRIPTION,
  COURSE_VISIBILITY_LABEL,
  ENROLLMENT_POLICY_DESCRIPTION,
  ENROLLMENT_POLICY_LABEL,
} from "@/lib/learn-labels";
import { useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import type { CourseCard } from "@nilovon-wiki/api/schemas/course";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Label } from "@nilovon-wiki/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nilovon-wiki/ui/components/select";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { Switch } from "@nilovon-wiki/ui/components/switch";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import type { JSONContent } from "@tiptap/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Visibility = CourseCard["visibility"];
type Policy = CourseCard["enrollmentPolicy"];
type Level = NonNullable<CourseCard["level"]>;

const LEVELS: readonly Level[] = ["beginner", "intermediate", "advanced"];
const VISIBILITIES: readonly Visibility[] = ["private", "organization", "public"];
const POLICIES: readonly Policy[] = ["open", "request", "invite", "paid"];

/** `<input type="date">` speaks YYYY-MM-DD; the API speaks Date. */
const toDateInput = (value: Date | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

/**
 * Everything about the course that is not its curriculum.
 *
 * The form is split by capability, not by topic: visibility, enrolment policy,
 * seat cap, enrolment deadline and the certificate switch decide *who gets in*
 * and are gated on `manage` server-side, while the rest only needs `author`.
 * Sending a restricted field an instructor cannot change would be refused as a
 * whole — `courses.update` re-checks the moment one of them is present — so
 * those keys are left out of the payload entirely rather than merely disabled in
 * the markup.
 */
export function CourseSettingsForm({ course }: { course: CourseCard }) {
  const canManage = course.access.canManage;
  const canAuthor = course.access.canAuthor;

  const [title, setTitle] = useState(course.title);
  const [slug, setSlug] = useState(course.slug);
  const [tagline, setTagline] = useState(course.tagline ?? "");
  const [description, setDescription] = useState<JSONContent | null>(
    (course.description as JSONContent | null) ?? null,
  );
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [level, setLevel] = useState<Level | null>(course.level);
  const [language, setLanguage] = useState(course.language ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    course.estimatedMinutes === null ? "" : String(course.estimatedMinutes),
  );
  const [sequential, setSequential] = useState(course.sequential);
  const [completionThreshold, setCompletionThreshold] = useState(
    String(course.completionThreshold),
  );
  const [visibility, setVisibility] = useState<Visibility>(course.visibility);
  const [policy, setPolicy] = useState<Policy>(course.enrollmentPolicy);
  const [maxSeats, setMaxSeats] = useState(course.maxSeats === null ? "" : String(course.maxSeats));
  const [closesAt, setClosesAt] = useState(toDateInput(course.enrollmentClosesAt));
  const [certificateEnabled, setCertificateEnabled] = useState(course.certificateEnabled);
  const [topicIds, setTopicIds] = useState<string[]>(course.topics.map((topic) => topic.id));

  const invalidateCourses = useInvalidate(orpc.learn.courses.key());
  const invalidateTopics = useInvalidate(orpc.learn.courseTopics.key());

  const topics = useQuery(orpc.learn.courseTopics.list.queryOptions({ input: {} }));
  const update = useMutation(
    orpc.learn.courses.update.mutationOptions({
      onSuccess: () => {
        invalidateCourses();
        setDescriptionDirty(false);
      },
      onError: toastLearnError,
    }),
  );
  const setTopics = useMutation(
    orpc.learn.courseTopics.setForCourse.mutationOptions({
      onSuccess: () => {
        invalidateCourses();
        invalidateTopics();
      },
      onError: toastLearnError,
    }),
  );

  const numberOrNull = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const submit = async () => {
    const payload: Parameters<typeof update.mutateAsync>[0] = { id: course.id };

    const trimmedTitle = title.trim();
    if (trimmedTitle && trimmedTitle !== course.title) payload.title = trimmedTitle;
    const trimmedSlug = slug.trim();
    if (trimmedSlug && trimmedSlug !== course.slug) payload.slug = trimmedSlug;
    if (tagline.trim() !== (course.tagline ?? "")) payload.tagline = tagline.trim() || null;
    if (descriptionDirty && description) payload.description = description;
    if (level !== course.level) payload.level = level;
    if (language.trim() !== (course.language ?? "")) payload.language = language.trim() || null;
    const minutes = numberOrNull(estimatedMinutes);
    if (minutes !== course.estimatedMinutes) payload.estimatedMinutes = minutes;
    if (sequential !== course.sequential) payload.sequential = sequential;
    const threshold = numberOrNull(completionThreshold);
    if (threshold !== null && threshold !== course.completionThreshold) {
      payload.completionThreshold = Math.min(100, Math.max(1, threshold));
    }

    // Restricted keys: present only when the caller may actually set them.
    if (canManage) {
      if (visibility !== course.visibility) payload.visibility = visibility;
      if (policy !== course.enrollmentPolicy) payload.enrollmentPolicy = policy;
      const seats = numberOrNull(maxSeats);
      if (seats !== course.maxSeats) payload.maxSeats = seats;
      if (closesAt !== toDateInput(course.enrollmentClosesAt)) {
        payload.enrollmentClosesAt = closesAt ? new Date(closesAt) : null;
      }
      if (certificateEnabled !== course.certificateEnabled) {
        payload.certificateEnabled = certificateEnabled;
      }
    }

    const current = course.topics.map((topic) => topic.id);
    const topicsChanged =
      topicIds.length !== current.length || topicIds.some((id) => !current.includes(id));

    if (Object.keys(payload).length === 1 && !topicsChanged) {
      toast.info("Keine Änderungen zu speichern.");
      return;
    }

    // Topics live in their own procedure, so a save is two calls; both are
    // awaited before the confirmation so a failed one never reads as success.
    if (Object.keys(payload).length > 1) await update.mutateAsync(payload);
    if (topicsChanged) await setTopics.mutateAsync({ courseId: course.id, topicIds });
    toast.success("Kurseinstellungen gespeichert");
  };

  const busy = update.isPending || setTopics.isPending;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Card className="space-y-4 p-4">
        <h3 className="text-sm font-semibold">Grunddaten</h3>

        <div className="space-y-1.5">
          <Label htmlFor="course-title">Titel</Label>
          <Input
            id="course-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!canAuthor}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="course-slug">Link</Label>
          <Input
            id="course-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            disabled={!canAuthor}
            maxLength={80}
          />
          <p className="text-muted-foreground text-xs">
            Kleinbuchstaben, Ziffern und Bindestriche. Ändert die Adresse des Kurses.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="course-tagline">Kurzbeschreibung</Label>
          <Textarea
            id="course-tagline"
            value={tagline}
            onChange={(event) => setTagline(event.target.value)}
            disabled={!canAuthor}
            maxLength={300}
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Beschreibung</span>
          <LearnRichText
            initialContent={course.description}
            ariaLabel="Kursbeschreibung"
            editable={canAuthor}
            onChange={(json) => {
              setDescription(json);
              setDescriptionDirty(true);
            }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="course-level">Niveau</Label>
            <Select
              value={level}
              onValueChange={(value) => setLevel((value as Level | null) ?? null)}
            >
              <SelectTrigger id="course-level" disabled={!canAuthor}>
                <SelectValue placeholder="Keine Angabe" />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {COURSE_LEVEL_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-language">Sprache</Label>
            <Input
              id="course-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={!canAuthor}
              maxLength={20}
              placeholder="z. B. de"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-duration">Geschätzte Dauer (Minuten)</Label>
            <Input
              id="course-duration"
              type="number"
              min={0}
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(event.target.value)}
              disabled={!canAuthor}
              placeholder="z. B. 180"
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Themen</legend>
          {topics.data && topics.data.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {topics.data.map((topic) => (
                <div key={topic.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`topic-${topic.id}`}
                    checked={topicIds.includes(topic.id)}
                    disabled={!canAuthor}
                    onCheckedChange={(next) =>
                      setTopicIds((current) =>
                        next
                          ? [...current, topic.id]
                          : current.filter((entry) => entry !== topic.id),
                      )
                    }
                  />
                  <Label htmlFor={`topic-${topic.id}`}>{topic.name}</Label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Für diese Organisation sind noch keine Themen angelegt.
            </p>
          )}
        </fieldset>
      </Card>

      <Card className="space-y-4 p-4">
        <h3 className="text-sm font-semibold">Ablauf</h3>

        <div className="flex items-start justify-between gap-4">
          <label htmlFor="course-sequential" className="min-w-0">
            <span className="block text-sm font-medium">Lektionen der Reihe nach</span>
            <span className="text-muted-foreground block text-xs">
              Eine Lektion öffnet sich erst, wenn die vorherige abgeschlossen ist.
            </span>
          </label>
          <Switch
            id="course-sequential"
            className="mt-1 shrink-0"
            checked={sequential}
            disabled={!canAuthor}
            onCheckedChange={(next) => setSequential(Boolean(next))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="course-threshold">Abschluss ab (%)</Label>
          <Input
            id="course-threshold"
            type="number"
            min={1}
            max={100}
            value={completionThreshold}
            onChange={(event) => setCompletionThreshold(event.target.value)}
            disabled={!canAuthor}
          />
          <p className="text-muted-foreground text-xs">
            Anteil der Pflichtlektionen, ab dem der Kurs als abgeschlossen gilt.
          </p>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Zugang</h3>
          {!canManage ? (
            <Badge variant="outline">
              <Lock className="size-3" aria-hidden />
              Nur für die Kursleitung
            </Badge>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="course-visibility">Sichtbarkeit</Label>
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as Visibility)}
            >
              <SelectTrigger id="course-visibility" disabled={!canManage}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITIES.map((value) => (
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
              <SelectTrigger id="course-policy" disabled={!canManage}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ENROLLMENT_POLICY_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{ENROLLMENT_POLICY_DESCRIPTION[policy]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-seats">Plätze</Label>
            <Input
              id="course-seats"
              type="number"
              min={1}
              value={maxSeats}
              onChange={(event) => setMaxSeats(event.target.value)}
              disabled={!canManage}
              placeholder="leer = unbegrenzt"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-closes">Einschreibefrist</Label>
            <Input
              id="course-closes"
              type="date"
              value={closesAt}
              onChange={(event) => setClosesAt(event.target.value)}
              disabled={!canManage}
            />
          </div>
        </div>

        <Separator />

        <div className="flex items-start justify-between gap-4">
          <label htmlFor="course-certificate" className="min-w-0">
            <span className="block text-sm font-medium">Zertifikat ausstellen</span>
            <span className="text-muted-foreground block text-xs">
              Wer den Kurs abschließt, erhält ein Zertifikat.
            </span>
          </label>
          <Switch
            id="course-certificate"
            className="mt-1 shrink-0"
            checked={certificateEnabled}
            disabled={!canManage}
            onCheckedChange={(next) => setCertificateEnabled(Boolean(next))}
          />
        </div>
      </Card>

      {canAuthor ? (
        <Button type="submit" disabled={busy}>
          <Save className="size-4" aria-hidden />
          {busy ? "Wird gespeichert …" : "Einstellungen speichern"}
        </Button>
      ) : null}
    </form>
  );
}
