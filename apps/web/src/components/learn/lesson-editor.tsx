import { ExternalLinkDialog } from "@/components/editor/external-link-dialog";
import { pageEditorExtensions } from "@/components/editor/extensions";
import { applyLink } from "@/components/editor/link-commands";
import { QueryError } from "@/components/query-error";
import { uploadCourseAsset } from "@/components/learn/course-thumbnail-upload";
import { LESSON_KIND_LABEL } from "@/lib/learn-labels";
import { useInvalidate } from "@/lib/query";
import { client, friendlyErrorMessage, orpc } from "@/utils/orpc";
import type { LessonKind } from "@nilovon-wiki/api/schemas/lesson";
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
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Spinner } from "@nilovon-wiki/ui/components/spinner";
import { Switch } from "@nilovon-wiki/ui/components/switch";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { type Editor, generateText, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ClipboardList,
  Code,
  Eye,
  EyeOff,
  FileText,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListPlus,
  Plus,
  Quote,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Per-kind authoring for one lesson. The kind is fixed at creation because the
 * server refuses a payload that does not match it — a video lesson carries an
 * asset, an embed carries a URL — so this editor switches on `lesson.kind`
 * rather than offering one form with every field on it.
 *
 * Quiz and assignment lessons open their own authoring surfaces here instead of
 * a separate route: both hang off the lesson, and sending an author elsewhere to
 * write three questions loses the curriculum they are working in.
 */

type LessonDetail = Awaited<ReturnType<typeof client.learn.lessons.get>>;
type AssignmentDetail = Awaited<ReturnType<typeof client.learn.assignments.getForLesson>>;
type QuizDetail = Awaited<ReturnType<typeof client.learn.quizzes.get>>;
type StaffQuestion = Extract<QuizDetail, { view: "full" }>["questions"][number];

// --- Server refusals --------------------------------------------------------

/**
 * German for the refusals the learning API states in prose.
 *
 * `friendlyErrorMessage` flattens every BAD_REQUEST to "Die Eingabe ist
 * ungültig", which is exactly wrong here: these messages name a missing piece
 * the author can go and add, and that is the whole value of the round-trip. The
 * lesson one is matched by substring because the server templates it three ways.
 */
export function learnRefusalMessage(error: Error): string | null {
  const message = (error as { message?: string }).message ?? "";
  if (message.includes("Add at least one lesson before publishing")) {
    return "Dieser Kurs braucht mindestens eine Lektion, bevor du ihn veröffentlichen kannst.";
  }
  if (message.includes("Add at least one task before publishing")) {
    return "Diese Aufgabe braucht mindestens einen Arbeitsschritt, bevor du sie veröffentlichen kannst.";
  }
  if (message.includes("still needs a file")) {
    return "Diese Lektion braucht noch eine hochgeladene Datei, bevor sie veröffentlicht werden kann.";
  }
  if (message.includes("still needs an embed URL")) {
    return "Diese Lektion braucht noch eine Einbettungs-URL, bevor sie veröffentlicht werden kann.";
  }
  if (message.includes("still needs some content")) {
    return "Diese Lektion braucht noch Inhalt, bevor sie veröffentlicht werden kann.";
  }
  if (message.includes("Only an embed lesson carries an embed URL")) {
    return "Nur eine eingebettete Lektion kann eine URL tragen.";
  }
  if (message.includes("Only a video or document lesson carries an uploaded file")) {
    return "Nur Video- und Dokument-Lektionen können eine Datei tragen.";
  }
  if (message.includes("slug already exists")) {
    return "Dieser Link ist bereits vergeben. Bitte wähle einen anderen.";
  }
  return null;
}

/** Mutation error handler that keeps the server's reason when it has one. */
export function toastLearnError(error: Error): void {
  toast.error(learnRefusalMessage(error) ?? friendlyErrorMessage(error));
}

// --- Shared rich text -------------------------------------------------------

/**
 * The wiki's TipTap schema, without collaboration.
 *
 * Lessons have no `collabToken` procedure and no shared Yjs document, so unlike
 * a page the body is plain local state saved straight into `content`. The
 * extension set is the shared one from `@nilovon-wiki/editor` regardless: a
 * divergent set builds a different ProseMirror schema, and a document written
 * against it loses every node the other side does not know.
 *
 * Exported because the course description edits the same kind of document; it
 * lives here because the lesson body is what it was built for.
 */
export function LearnRichText({
  initialContent,
  onChange,
  ariaLabel,
  editable = true,
}: {
  initialContent: unknown;
  onChange: (json: JSONContent) => void;
  ariaLabel: string;
  editable?: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: pageEditorExtensions(),
    content: (initialContent as JSONContent | null) ?? "",
    onUpdate: ({ editor: instance }) => onChange(instance.getJSON()),
    editorProps: {
      attributes: {
        class: "tiptap min-h-[240px] px-3 py-2 focus:outline-none",
        "aria-label": ariaLabel,
      },
    },
  });

  return (
    <div className="rounded-md border">
      {editable && editor ? (
        <RichTextToolbar editor={editor} onLink={() => setLinkOpen(true)} />
      ) : null}
      <EditorContent editor={editor} />
      {editor ? (
        <ExternalLinkDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          showText={editor.state.selection.empty && !editor.isActive("link")}
          onSubmit={(link) => applyLink(editor, link)}
        />
      ) : null}
    </div>
  );
}

/**
 * A deliberately small toolbar. The page editor's own toolbar offers wiki page
 * links and image uploads, both of which need a space — a course has none — so
 * this covers the formatting a lesson body actually uses and nothing else.
 */
function RichTextToolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const actions: Array<{ icon: typeof Bold; label: string; run: () => void }> = [
    { icon: Bold, label: "Fett", run: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, label: "Kursiv", run: () => editor.chain().focus().toggleItalic().run() },
    { icon: Code, label: "Code", run: () => editor.chain().focus().toggleCode().run() },
    {
      icon: Heading2,
      label: "Überschrift 2",
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      icon: Heading3,
      label: "Überschrift 3",
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    { icon: List, label: "Liste", run: () => editor.chain().focus().toggleBulletList().run() },
    {
      icon: ListOrdered,
      label: "Nummerierte Liste",
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    { icon: Quote, label: "Zitat", run: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: Link2, label: "Link einfügen", run: onLink },
  ];

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
      {actions.map((action) => (
        <Button
          key={action.label}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={action.label}
          title={action.label}
          onClick={action.run}
        >
          <action.icon className="size-4" aria-hidden />
        </Button>
      ))}
    </div>
  );
}

// --- Lesson editor ----------------------------------------------------------

export function LessonEditor({
  lessonId,
  courseId,
  canAuthor,
}: {
  lessonId: string;
  courseId: string;
  canAuthor: boolean;
}) {
  const lesson = useQuery(orpc.learn.lessons.get.queryOptions({ input: { id: lessonId } }));

  if (lesson.isError) {
    return <QueryError error={lesson.error} onRetry={() => void lesson.refetch()} />;
  }
  if (lesson.isPending || !lesson.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Remounted per lesson so every field seeds from the row it belongs to; a
  // shared form would carry the previous lesson's unsaved text across.
  return (
    <LessonForm
      key={lesson.data.id}
      lesson={lesson.data}
      courseId={courseId}
      canAuthor={canAuthor}
    />
  );
}

function LessonForm({
  lesson,
  courseId,
  canAuthor,
}: {
  lesson: LessonDetail;
  courseId: string;
  canAuthor: boolean;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [content, setContent] = useState<JSONContent | null>(
    (lesson.content as JSONContent | null) ?? null,
  );
  const [contentDirty, setContentDirty] = useState(false);
  const [embedUrl, setEmbedUrl] = useState(lesson.embedUrl ?? "");
  const [minutes, setMinutes] = useState(
    lesson.durationSeconds ? String(Math.round(lesson.durationSeconds / 60)) : "",
  );
  const [isRequired, setIsRequired] = useState(lesson.isRequired);
  const [autoComplete, setAutoComplete] = useState(
    lesson.autoCompleteAtPercent === null ? "" : String(lesson.autoCompleteAtPercent),
  );

  const invalidateLessons = useInvalidate(orpc.learn.lessons.key());
  const update = useMutation(
    orpc.learn.lessons.update.mutationOptions({
      onSuccess: () => {
        invalidateLessons();
        setContentDirty(false);
        toast.success("Lektion gespeichert");
      },
      onError: toastLearnError,
    }),
  );
  const publish = useMutation(
    orpc.learn.lessons.publish.mutationOptions({
      onSuccess: (updated) => {
        invalidateLessons();
        toast.success(updated.publishedAt ? "Lektion veröffentlicht" : "Lektion zurückgezogen");
      },
      onError: toastLearnError,
    }),
  );

  const published = lesson.publishedAt !== null;

  const save = () => {
    const trimmedTitle = title.trim();
    const parsedMinutes = Number.parseInt(minutes, 10);
    const durationSeconds = minutes.trim() === "" ? null : Math.max(0, parsedMinutes) * 60;
    const parsedPercent = Number.parseInt(autoComplete, 10);
    const autoCompleteAtPercent =
      autoComplete.trim() === "" ? null : Math.min(100, Math.max(1, parsedPercent));

    // Every key is optional and every one that is *sent* overwrites. Only
    // changed fields travel, which is also what keeps a title-only save from
    // blanking the search projection: no `content`, so no `textContent`.
    const payload: Parameters<typeof update.mutate>[0] = { id: lesson.id };
    if (trimmedTitle && trimmedTitle !== lesson.title) payload.title = trimmedTitle;
    if (lesson.kind === "dynamic" && contentDirty && content) {
      payload.content = content;
      // The plaintext projection the server stores for search. Derived from the
      // same extension set the document was written with, so the text matches
      // what a reader sees rather than a serialization of raw JSON.
      payload.textContent = generateText(content, pageEditorExtensions());
    }
    if (lesson.kind === "embed") {
      const trimmed = embedUrl.trim();
      if (trimmed !== (lesson.embedUrl ?? "")) payload.embedUrl = trimmed || null;
    }
    if (durationSeconds !== lesson.durationSeconds) payload.durationSeconds = durationSeconds;
    if (isRequired !== lesson.isRequired) payload.isRequired = isRequired;
    if (autoCompleteAtPercent !== lesson.autoCompleteAtPercent) {
      payload.autoCompleteAtPercent = autoCompleteAtPercent;
    }
    update.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="lesson-title">Titel der Lektion</Label>
          <Input
            id="lesson-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!canAuthor}
            maxLength={200}
          />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Badge variant="secondary">{LESSON_KIND_LABEL[lesson.kind]}</Badge>
          <Badge variant="outline">{published ? "Veröffentlicht" : "Entwurf"}</Badge>
        </div>
      </div>

      {canAuthor ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Spinner /> : <Save className="size-4" aria-hidden />}
            Speichern
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={publish.isPending}
            onClick={() => publish.mutate({ id: lesson.id, published: !published })}
          >
            {published ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
            {published ? "Zurückziehen" : "Veröffentlichen"}
          </Button>
        </div>
      ) : null}

      <Separator />

      {lesson.kind === "dynamic" ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Inhalt</h3>
          <LearnRichText
            initialContent={lesson.content}
            ariaLabel="Lektionsinhalt"
            editable={canAuthor}
            onChange={(json) => {
              setContent(json);
              setContentDirty(true);
            }}
          />
          <p className="text-muted-foreground text-xs">
            Änderungen am Text werden erst mit „Speichern“ übernommen.
          </p>
        </section>
      ) : null}

      {lesson.kind === "video" || lesson.kind === "document" ? (
        <LessonAssetField lesson={lesson} courseId={courseId} canAuthor={canAuthor} />
      ) : null}

      {lesson.kind === "embed" ? (
        <section className="space-y-2">
          <Label htmlFor="lesson-embed">Einbettungs-URL</Label>
          <Input
            id="lesson-embed"
            type="url"
            inputMode="url"
            value={embedUrl}
            onChange={(event) => setEmbedUrl(event.target.value)}
            placeholder="https://…"
            disabled={!canAuthor}
            maxLength={2000}
          />
          <p className="text-muted-foreground text-xs">
            Adresse einer Seite, die sich einbetten lässt — etwa ein Video oder ein interaktives
            Werkzeug.
          </p>
        </section>
      ) : null}

      {lesson.kind === "quiz" ? (
        <QuizLessonEditor lesson={lesson} courseId={courseId} canAuthor={canAuthor} />
      ) : null}

      {lesson.kind === "assignment" ? (
        <AssignmentLessonEditor lesson={lesson} courseId={courseId} canAuthor={canAuthor} />
      ) : null}

      <Separator />

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Einstellungen</h3>

        <div className="flex items-start justify-between gap-4">
          <label htmlFor="lesson-required" className="min-w-0">
            <span className="block text-sm font-medium">Pflichtlektion</span>
            <span className="text-muted-foreground block text-xs">
              Optionale Lektionen zählen nicht für den Kursabschluss.
            </span>
          </label>
          <Switch
            id="lesson-required"
            className="mt-1 shrink-0"
            checked={isRequired}
            disabled={!canAuthor}
            onCheckedChange={(next) => setIsRequired(Boolean(next))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lesson-duration">Dauer (Minuten)</Label>
            <Input
              id="lesson-duration"
              type="number"
              min={0}
              max={1440}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              disabled={!canAuthor}
              placeholder="z. B. 12"
            />
            <p className="text-muted-foreground text-xs">
              Wird im Kursinhalt angezeigt und in die Kursdauer eingerechnet.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lesson-autocomplete">Automatisch abschließen ab (%)</Label>
            <Input
              id="lesson-autocomplete"
              type="number"
              min={1}
              max={100}
              value={autoComplete}
              onChange={(event) => setAutoComplete(event.target.value)}
              disabled={!canAuthor}
              placeholder="leer = manuell"
            />
            <p className="text-muted-foreground text-xs">
              Ab diesem Anteil gilt die Lektion als abgeschlossen. Leer lassen, damit Lernende
              selbst abhaken.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- video / document -------------------------------------------------------

function LessonAssetField({
  lesson,
  courseId,
  canAuthor,
}: {
  lesson: LessonDetail;
  courseId: string;
  canAuthor: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const invalidateLessons = useInvalidate(orpc.learn.lessons.key());
  const capabilities = useQuery(orpc.learn.assets.capabilities.queryOptions({ input: {} }));
  const update = useMutation(
    orpc.learn.lessons.update.mutationOptions({
      onSuccess: () => invalidateLessons(),
      onError: toastLearnError,
    }),
  );

  const kind = lesson.kind === "video" ? "video" : "document";
  const storageEnabled = capabilities.data?.enabled ?? false;
  const maxBytes = capabilities.data?.maxUploadBytes ?? 0;

  const handleFile = async (file: File) => {
    if (maxBytes && file.size > maxBytes) {
      toast.error(
        `Die Datei ist größer als ${Math.round(maxBytes / (1024 * 1024))} MB und kann nicht hochgeladen werden.`,
      );
      return;
    }
    setUploading(true);
    try {
      // Two steps by design: the bytes go to the multipart route, and the lesson
      // only points at the asset once it exists.
      const asset = await uploadCourseAsset({ courseId, kind, file });
      await update.mutateAsync({ id: lesson.id, assetId: asset.id });
      toast.success(`${file.name} hochgeladen`);
    } catch (error) {
      toast.error(learnRefusalMessage(error as Error) ?? friendlyErrorMessage(error as Error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{lesson.kind === "video" ? "Video" : "Dokument"}</h3>

      {lesson.assetUrl ? (
        lesson.kind === "video" ? (
          <video src={lesson.assetUrl} controls className="w-full rounded-lg bg-black" />
        ) : (
          <a
            href={lesson.assetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary flex items-center gap-2 text-sm underline"
          >
            <FileText className="size-4" aria-hidden />
            Hochgeladenes Dokument öffnen
          </a>
        )
      ) : (
        <p className="text-muted-foreground text-sm">
          Noch keine Datei hochgeladen. Ohne Datei lässt sich die Lektion nicht veröffentlichen.
        </p>
      )}

      {canAuthor ? (
        <div className="space-y-2">
          <Label htmlFor="lesson-asset">
            {lesson.assetUrl ? "Datei ersetzen" : "Datei hochladen"}
          </Label>
          <Input
            id="lesson-asset"
            type="file"
            accept={
              lesson.kind === "video" ? "video/*" : ".pdf,application/pdf,.doc,.docx,.odt,.txt"
            }
            disabled={!storageEnabled || uploading || update.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {capabilities.isSuccess && !storageEnabled ? (
            <p className="text-muted-foreground text-xs">
              Für Uploads muss in dieser Installation ein Dateispeicher eingerichtet sein.
            </p>
          ) : null}
          {uploading ? (
            <p className="text-muted-foreground flex items-center gap-2 text-xs">
              <Spinner /> Wird hochgeladen …
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// --- quiz -------------------------------------------------------------------

/**
 * A quiz lesson names its quiz in `lesson.content`.
 *
 * The API gives an assignment a `lessonId` column and a `getForLesson` lookup,
 * but a quiz belongs to the *course* and `quizzes.listForCourse` is author-only
 * — so there is exactly one field a learner may read that can carry the link,
 * and this is it. `{ quizId }` and nothing else, so the player's read is a
 * single property access.
 */
function quizIdFromContent(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const value = (content as { quizId?: unknown }).quizId;
  return typeof value === "string" && value ? value : null;
}

function QuizLessonEditor({
  lesson,
  courseId,
  canAuthor,
}: {
  lesson: LessonDetail;
  courseId: string;
  canAuthor: boolean;
}) {
  const quizId = quizIdFromContent(lesson.content);
  const invalidateLessons = useInvalidate(orpc.learn.lessons.key());
  const invalidateQuizzes = useInvalidate(orpc.learn.quizzes.key());

  const quizzes = useQuery({
    ...orpc.learn.quizzes.listForCourse.queryOptions({ input: { courseId } }),
    // The listing is author-gated server-side; asking as a reviewer would only
    // produce a toast about a permission the page already knows is missing.
    enabled: canAuthor,
  });
  const bind = useMutation(
    orpc.learn.lessons.update.mutationOptions({
      onSuccess: () => invalidateLessons(),
      onError: toastLearnError,
    }),
  );
  const create = useMutation(
    orpc.learn.quizzes.create.mutationOptions({
      onSuccess: (quiz) => {
        invalidateQuizzes();
        bind.mutate({ id: lesson.id, content: { quizId: quiz.id } });
      },
      onError: toastLearnError,
    }),
  );

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Quiz</h3>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="lesson-quiz">Verknüpftes Quiz</Label>
          <Select
            value={quizId}
            onValueChange={(value) =>
              bind.mutate({ id: lesson.id, content: value ? { quizId: value } : null })
            }
          >
            <SelectTrigger id="lesson-quiz" disabled={!canAuthor}>
              <SelectValue placeholder="Kein Quiz verknüpft" />
            </SelectTrigger>
            <SelectContent>
              {(quizzes.data ?? []).map((quiz) => (
                <SelectItem key={quiz.id} value={quiz.id}>
                  {quiz.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canAuthor ? (
          <Button
            type="button"
            variant="outline"
            disabled={create.isPending}
            onClick={() => create.mutate({ courseId, title: lesson.title || "Neues Quiz" })}
          >
            <Plus className="size-4" aria-hidden />
            Neues Quiz
          </Button>
        ) : null}
      </div>

      {quizId ? (
        <QuizQuestionsEditor quizId={quizId} canAuthor={canAuthor} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Diese Lektion zeigt erst etwas an, wenn ein Quiz verknüpft ist.
        </p>
      )}
    </section>
  );
}

const QUESTION_KIND_LABEL: Record<string, string> = {
  single_choice: "Eine richtige Antwort",
  multiple_choice: "Mehrere richtige Antworten",
  true_false: "Wahr oder falsch",
  short_answer: "Freitext",
};

const ANSWER_REVEAL_LABEL: Record<string, string> = {
  never: "Nie",
  after_attempt: "Nach jedem Versuch",
  after_pass: "Erst nach dem Bestehen",
};

function QuizQuestionsEditor({ quizId, canAuthor }: { quizId: string; canAuthor: boolean }) {
  const quiz = useQuery(orpc.learn.quizzes.get.queryOptions({ input: { id: quizId } }));
  const invalidateQuizzes = useInvalidate(orpc.learn.quizzes.key());
  const options = { onSuccess: () => invalidateQuizzes(), onError: toastLearnError };

  const updateQuiz = useMutation(orpc.learn.quizzes.update.mutationOptions(options));
  const addQuestion = useMutation(orpc.learn.quizzes.addQuestion.mutationOptions(options));

  if (quiz.isError) {
    return <QueryError compact error={quiz.error} onRetry={() => void quiz.refetch()} />;
  }
  if (quiz.isPending || !quiz.data) return <Skeleton className="h-32 w-full" />;
  // The redacted projection is what a learner receives; an author who somehow
  // sees it has no answer key to edit, so say so rather than render a form that
  // would silently drop `isCorrect`.
  if (quiz.data.view !== "full") {
    return (
      <p className="text-muted-foreground text-sm">
        Dieses Quiz lässt sich hier nicht bearbeiten — dir fehlt die Berechtigung dafür.
      </p>
    );
  }

  const detail = quiz.data;

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="quiz-title">Titel des Quiz</Label>
          <Input
            id="quiz-title"
            defaultValue={detail.quiz.title}
            disabled={!canAuthor}
            maxLength={200}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== detail.quiz.title) {
                updateQuiz.mutate({ id: detail.quiz.id, title: value });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quiz-passing">Bestehensgrenze (%)</Label>
          <Input
            id="quiz-passing"
            type="number"
            min={0}
            max={100}
            defaultValue={detail.quiz.passingPercent}
            disabled={!canAuthor}
            onBlur={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value !== detail.quiz.passingPercent) {
                updateQuiz.mutate({
                  id: detail.quiz.id,
                  passingPercent: Math.min(100, Math.max(0, value)),
                });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quiz-attempts">Maximale Versuche</Label>
          <Input
            id="quiz-attempts"
            type="number"
            min={1}
            max={1000}
            defaultValue={detail.quiz.maxAttempts ?? ""}
            disabled={!canAuthor}
            placeholder="leer = unbegrenzt"
            onBlur={(event) => {
              const raw = event.target.value.trim();
              const value = raw === "" ? null : Number.parseInt(raw, 10);
              updateQuiz.mutate({
                id: detail.quiz.id,
                maxAttempts: value === null || !Number.isFinite(value) ? null : Math.max(1, value),
              });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quiz-reveal">Lösungen zeigen</Label>
          <Select
            value={detail.quiz.answerReveal}
            onValueChange={(value) =>
              updateQuiz.mutate({
                id: detail.quiz.id,
                answerReveal: value as "never" | "after_attempt" | "after_pass",
              })
            }
          >
            <SelectTrigger id="quiz-reveal" disabled={!canAuthor}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ANSWER_REVEAL_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <ul className="space-y-3">
        {detail.questions.map((question, index) => (
          <li key={question.id}>
            <QuizQuestionRow
              question={question}
              index={index}
              previousId={index > 0 ? detail.questions[index - 1]!.id : null}
              nextId={index < detail.questions.length - 1 ? detail.questions[index + 1]!.id : null}
              canAuthor={canAuthor}
            />
          </li>
        ))}
      </ul>

      {canAuthor ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={addQuestion.isPending}
          onClick={() =>
            addQuestion.mutate({
              quizId: detail.quiz.id,
              kind: "single_choice",
              promptText: "Neue Frage",
              points: 1,
              options: [
                { label: "Antwort A", isCorrect: true },
                { label: "Antwort B", isCorrect: false },
              ],
            })
          }
        >
          <ListPlus className="size-4" aria-hidden />
          Frage hinzufügen
        </Button>
      ) : null}
    </div>
  );
}

function QuizQuestionRow({
  question,
  index,
  previousId,
  nextId,
  canAuthor,
}: {
  question: StaffQuestion;
  index: number;
  previousId: string | null;
  nextId: string | null;
  canAuthor: boolean;
}) {
  const invalidateQuizzes = useInvalidate(orpc.learn.quizzes.key());
  const options = { onSuccess: () => invalidateQuizzes(), onError: toastLearnError };

  const updateQuestion = useMutation(orpc.learn.quizzes.updateQuestion.mutationOptions(options));
  const deleteQuestion = useMutation(orpc.learn.quizzes.deleteQuestion.mutationOptions(options));
  const moveQuestion = useMutation(orpc.learn.quizzes.moveQuestion.mutationOptions(options));
  const addOption = useMutation(orpc.learn.quizzes.addOption.mutationOptions(options));
  const updateOption = useMutation(orpc.learn.quizzes.updateOption.mutationOptions(options));
  const deleteOption = useMutation(orpc.learn.quizzes.deleteOption.mutationOptions(options));

  const accepted = Array.isArray(question.acceptedAnswers)
    ? (question.acceptedAnswers as string[]).join(", ")
    : "";

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground pt-2 text-sm tabular-nums">{index + 1}.</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor={`question-${question.id}`} className="sr-only">
            Frage {index + 1}
          </Label>
          <Textarea
            id={`question-${question.id}`}
            defaultValue={question.promptText}
            disabled={!canAuthor}
            rows={2}
            onBlur={(event) => {
              const value = event.target.value;
              if (value !== question.promptText) {
                updateQuestion.mutate({ id: question.id, promptText: value });
              }
            }}
          />
        </div>
        {canAuthor ? (
          <div className="flex shrink-0 gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Frage ${index + 1} nach oben`}
              disabled={!previousId || moveQuestion.isPending}
              onClick={() =>
                previousId && moveQuestion.mutate({ id: question.id, beforeId: previousId })
              }
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Frage ${index + 1} nach unten`}
              disabled={!nextId || moveQuestion.isPending}
              onClick={() => nextId && moveQuestion.mutate({ id: question.id, afterId: nextId })}
            >
              <ArrowDown className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Frage ${index + 1} löschen`}
              disabled={deleteQuestion.isPending}
              onClick={() => {
                if (window.confirm("Diese Frage mit allen Antworten löschen?")) {
                  deleteQuestion.mutate({ id: question.id });
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`question-kind-${question.id}`}>Fragetyp</Label>
          <Select
            value={question.kind}
            onValueChange={(value) =>
              updateQuestion.mutate({
                id: question.id,
                kind: value as StaffQuestion["kind"],
              })
            }
          >
            <SelectTrigger id={`question-kind-${question.id}`} disabled={!canAuthor}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(QUESTION_KIND_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`question-points-${question.id}`}>Punkte</Label>
          <Input
            id={`question-points-${question.id}`}
            type="number"
            min={0}
            max={1000}
            defaultValue={question.points}
            disabled={!canAuthor}
            onBlur={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value !== question.points) {
                updateQuestion.mutate({ id: question.id, points: Math.max(0, value) });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`question-explanation-${question.id}`}>Erklärung</Label>
          <Input
            id={`question-explanation-${question.id}`}
            defaultValue={question.explanation ?? ""}
            disabled={!canAuthor}
            placeholder="Warum ist das richtig?"
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== (question.explanation ?? "")) {
                updateQuestion.mutate({ id: question.id, explanation: value || null });
              }
            }}
          />
        </div>
      </div>

      {question.kind === "short_answer" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`question-accepted-${question.id}`}>
            Akzeptierte Antworten (durch Komma getrennt)
          </Label>
          <Input
            id={`question-accepted-${question.id}`}
            defaultValue={accepted}
            disabled={!canAuthor}
            onBlur={(event) => {
              const value = event.target.value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
              updateQuestion.mutate({
                id: question.id,
                acceptedAnswers: value.length ? value : null,
              });
            }}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <span className="text-sm font-medium">Antwortmöglichkeiten</span>
          <ul className="space-y-2">
            {question.options.map((option) => (
              <li key={option.id} className="flex items-center gap-2">
                <Checkbox
                  id={`option-${option.id}`}
                  checked={option.isCorrect}
                  disabled={!canAuthor}
                  onCheckedChange={(next) =>
                    updateOption.mutate({ id: option.id, isCorrect: Boolean(next) })
                  }
                />
                <Label htmlFor={`option-${option.id}`} className="sr-only">
                  Antwort ist richtig
                </Label>
                <Input
                  aria-label={`Antworttext für „${option.label}“`}
                  defaultValue={option.label}
                  disabled={!canAuthor}
                  maxLength={500}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value && value !== option.label) {
                      updateOption.mutate({ id: option.id, label: value });
                    }
                  }}
                />
                {canAuthor ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Antwort „${option.label}“ löschen`}
                    onClick={() => deleteOption.mutate({ id: option.id })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {canAuthor ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={addOption.isPending}
              onClick={() =>
                addOption.mutate({
                  questionId: question.id,
                  label: `Antwort ${question.options.length + 1}`,
                  isCorrect: false,
                })
              }
            >
              <Plus className="size-4" aria-hidden />
              Antwort hinzufügen
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// --- assignment -------------------------------------------------------------

const TASK_KIND_LABEL: Record<string, string> = {
  text: "Textantwort",
  file: "Datei-Abgabe",
  quiz: "Quiz",
};

function AssignmentLessonEditor({
  lesson,
  courseId,
  canAuthor,
}: {
  lesson: LessonDetail;
  courseId: string;
  canAuthor: boolean;
}) {
  const invalidateAssignments = useInvalidate(orpc.learn.assignments.key());
  // Hand-rolled rather than `queryOptions`: a lesson without a brief answers
  // NOT_FOUND, which is a state and not a failure. Letting it surface as a query
  // error would retry it and raise the global "nicht gefunden" toast every time
  // an author opens a fresh assignment lesson.
  const assignment = useQuery({
    queryKey: orpc.learn.assignments.getForLesson.key({ input: { lessonId: lesson.id } }),
    queryFn: async () => {
      try {
        return await client.learn.assignments.getForLesson({ lessonId: lesson.id });
      } catch (error) {
        if ((error as { code?: string }).code === "NOT_FOUND") return null;
        throw error;
      }
    },
  });
  const create = useMutation(
    orpc.learn.assignments.create.mutationOptions({
      onSuccess: () => invalidateAssignments(),
      onError: toastLearnError,
    }),
  );

  if (assignment.isPending) return <Skeleton className="h-40 w-full" />;

  if (!assignment.data) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Aufgabe</h3>
        <p className="text-muted-foreground text-sm">
          Für diese Lektion gibt es noch keine Aufgabenstellung.
        </p>
        {canAuthor ? (
          <Button
            type="button"
            variant="outline"
            disabled={create.isPending}
            onClick={() =>
              create.mutate({ lessonId: lesson.id, title: lesson.title || "Neue Aufgabe" })
            }
          >
            <ClipboardList className="size-4" aria-hidden />
            Aufgabe anlegen
          </Button>
        ) : null}
      </section>
    );
  }

  return (
    <AssignmentForm
      key={assignment.data.id}
      assignment={assignment.data}
      courseId={courseId}
      canAuthor={canAuthor}
    />
  );
}

function AssignmentForm({
  assignment,
  courseId,
  canAuthor,
}: {
  assignment: AssignmentDetail;
  courseId: string;
  canAuthor: boolean;
}) {
  const [instructions, setInstructions] = useState<JSONContent | null>(
    (assignment.instructions as JSONContent | null) ?? null,
  );
  const [instructionsDirty, setInstructionsDirty] = useState(false);

  const invalidateAssignments = useInvalidate(orpc.learn.assignments.key());
  const options = { onSuccess: () => invalidateAssignments(), onError: toastLearnError };

  const quizzes = useQuery({
    ...orpc.learn.quizzes.listForCourse.queryOptions({ input: { courseId } }),
    enabled: canAuthor,
  });
  const update = useMutation(orpc.learn.assignments.update.mutationOptions(options));
  const publish = useMutation(orpc.learn.assignments.publish.mutationOptions(options));
  const addTask = useMutation(orpc.learn.assignments.addTask.mutationOptions(options));
  const updateTask = useMutation(orpc.learn.assignments.updateTask.mutationOptions(options));
  const deleteTask = useMutation(orpc.learn.assignments.deleteTask.mutationOptions(options));
  const moveTask = useMutation(orpc.learn.assignments.moveTask.mutationOptions(options));

  const dueValue = assignment.dueAt ? new Date(assignment.dueAt).toISOString().slice(0, 10) : "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Aufgabe</h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{assignment.publishedAt ? "Veröffentlicht" : "Entwurf"}</Badge>
          {canAuthor && !assignment.publishedAt ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={publish.isPending}
              onClick={() => publish.mutate({ id: assignment.id })}
            >
              <Eye className="size-4" aria-hidden />
              Aufgabe veröffentlichen
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="assignment-title">Titel</Label>
          <Input
            id="assignment-title"
            defaultValue={assignment.title}
            disabled={!canAuthor}
            maxLength={200}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== assignment.title) {
                update.mutate({ id: assignment.id, title: value });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assignment-due">Abgabefrist</Label>
          <Input
            id="assignment-due"
            type="date"
            defaultValue={dueValue}
            disabled={!canAuthor}
            onBlur={(event) => {
              const raw = event.target.value;
              if (raw === dueValue) return;
              update.mutate({ id: assignment.id, dueAt: raw ? new Date(raw) : null });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assignment-passing">Bestehensgrenze (Punkte)</Label>
          <Input
            id="assignment-passing"
            type="number"
            min={0}
            defaultValue={assignment.passingGrade}
            disabled={!canAuthor}
            onBlur={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value !== assignment.passingGrade) {
                update.mutate({ id: assignment.id, passingGrade: Math.max(0, value) });
              }
            }}
          />
          <p className="text-muted-foreground text-xs">
            Von insgesamt {assignment.maxGrade} Punkten (Summe der Arbeitsschritte).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assignment-grading">Bewertung</Label>
          <Select
            value={assignment.gradingMethod}
            onValueChange={(value) =>
              update.mutate({ id: assignment.id, gradingMethod: value as "auto" | "manual" })
            }
          >
            <SelectTrigger id="assignment-grading" disabled={!canAuthor}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Von Hand</SelectItem>
              <SelectItem value="auto">Automatisch</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start justify-between gap-4">
          <label htmlFor="assignment-late" className="min-w-0">
            <span className="block text-sm font-medium">Verspätete Abgaben erlauben</span>
          </label>
          <Switch
            id="assignment-late"
            className="mt-1 shrink-0"
            checked={assignment.allowLateSubmission}
            disabled={!canAuthor}
            onCheckedChange={(next) =>
              update.mutate({ id: assignment.id, allowLateSubmission: Boolean(next) })
            }
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <label htmlFor="assignment-blind" className="min-w-0">
            <span className="block text-sm font-medium">Anonym bewerten</span>
            <span className="text-muted-foreground block text-xs">
              Der Name wird erst nach der Bewertung sichtbar.
            </span>
          </label>
          <Switch
            id="assignment-blind"
            className="mt-1 shrink-0"
            checked={assignment.blindGrading}
            disabled={!canAuthor}
            onCheckedChange={(next) =>
              update.mutate({ id: assignment.id, blindGrading: Boolean(next) })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Aufgabenstellung</span>
        <LearnRichText
          initialContent={assignment.instructions}
          ariaLabel="Aufgabenstellung"
          editable={canAuthor}
          onChange={(json) => {
            setInstructions(json);
            setInstructionsDirty(true);
          }}
        />
        {canAuthor ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!instructionsDirty || update.isPending}
            onClick={() => {
              if (!instructions) return;
              update.mutate(
                {
                  id: assignment.id,
                  instructions,
                  // Same contract as the lesson body: the plaintext projection
                  // travels with the JSON it was derived from, never alone.
                  instructionsText: generateText(instructions, pageEditorExtensions()),
                },
                { onSuccess: () => setInstructionsDirty(false) },
              );
            }}
          >
            <Save className="size-4" aria-hidden />
            Aufgabenstellung speichern
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Arbeitsschritte</span>
        {assignment.tasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Ohne Arbeitsschritte lässt sich die Aufgabe nicht veröffentlichen.
          </p>
        ) : null}
        <ul className="space-y-2">
          {assignment.tasks.map((task, index) => (
            <li key={task.id}>
              <Card className="flex flex-wrap items-end gap-2 p-3">
                <div className="min-w-40 flex-1 space-y-1.5">
                  <Label htmlFor={`task-title-${task.id}`}>Titel</Label>
                  <Input
                    id={`task-title-${task.id}`}
                    defaultValue={task.title}
                    disabled={!canAuthor}
                    maxLength={200}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== task.title) {
                        updateTask.mutate({ id: task.id, title: value });
                      }
                    }}
                  />
                </div>
                <div className="w-28 space-y-1.5">
                  <Label htmlFor={`task-grade-${task.id}`}>Punkte</Label>
                  <Input
                    id={`task-grade-${task.id}`}
                    type="number"
                    min={0}
                    defaultValue={task.maxGrade}
                    disabled={!canAuthor}
                    onBlur={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      if (Number.isFinite(value) && value !== task.maxGrade) {
                        updateTask.mutate({ id: task.id, maxGrade: Math.max(0, value) });
                      }
                    }}
                  />
                </div>
                {task.kind === "quiz" ? (
                  <div className="min-w-44 flex-1 space-y-1.5">
                    <Label htmlFor={`task-quiz-${task.id}`}>Quiz</Label>
                    <Select
                      value={task.quizId}
                      onValueChange={(value) => updateTask.mutate({ id: task.id, quizId: value })}
                    >
                      <SelectTrigger id={`task-quiz-${task.id}`} disabled={!canAuthor}>
                        <SelectValue placeholder="Quiz wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {(quizzes.data ?? []).map((quiz) => (
                          <SelectItem key={quiz.id} value={quiz.id}>
                            {quiz.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <Badge variant="secondary" className="mb-2">
                    {TASK_KIND_LABEL[task.kind] ?? task.kind}
                  </Badge>
                )}
                {canAuthor ? (
                  <div className="mb-0.5 flex gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Arbeitsschritt „${task.title}" nach oben`}
                      disabled={index === 0 || moveTask.isPending}
                      onClick={() =>
                        moveTask.mutate({
                          id: task.id,
                          // Fractional ordering: the anchor is the row that will
                          // sit before it, and null means "to the very front".
                          afterTaskId: index >= 2 ? assignment.tasks[index - 2]!.id : null,
                        })
                      }
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Arbeitsschritt „${task.title}" nach unten`}
                      disabled={index === assignment.tasks.length - 1 || moveTask.isPending}
                      onClick={() =>
                        moveTask.mutate({
                          id: task.id,
                          afterTaskId: assignment.tasks[index + 1]!.id,
                        })
                      }
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Arbeitsschritt „${task.title}" löschen`}
                      onClick={() => {
                        if (window.confirm("Diesen Arbeitsschritt und alle Antworten löschen?")) {
                          deleteTask.mutate({ id: task.id });
                        }
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>

        {canAuthor ? (
          <div className="flex flex-wrap gap-2">
            {(["text", "file", "quiz"] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="outline"
                size="sm"
                disabled={addTask.isPending}
                onClick={() =>
                  addTask.mutate({
                    id: assignment.id,
                    kind,
                    title: TASK_KIND_LABEL[kind] ?? "Arbeitsschritt",
                    maxGrade: 100,
                    // A quiz task must name a quiz of the same course; the first
                    // one is a sensible default and the select above changes it.
                    ...(kind === "quiz" ? { quizId: quizzes.data?.[0]?.id ?? null } : {}),
                  })
                }
              >
                {kind === "file" ? (
                  <Upload className="size-4" aria-hidden />
                ) : (
                  <Plus className="size-4" aria-hidden />
                )}
                {TASK_KIND_LABEL[kind]}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Kinds an author can pick when adding a lesson, in the order the menu shows. */
export const LESSON_KINDS: readonly LessonKind[] = [
  "dynamic",
  "video",
  "document",
  "embed",
  "quiz",
  "assignment",
];

/** Shared row classes for the curriculum, so both editors stay in step. */
export const lessonRowClass = (active: boolean) =>
  cn(
    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
    active ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent",
  );
