# T07 — @-Mentions benachrichtigen

**Ziel:** Wer erwähnt wird, erfährt davon. Heute ist die Erwähnung eine reine
Textdekoration.

## Ist-Zustand

Der Editor-Teil ist **vollständig fertig** — dieses Ticket ist reine Zustellung:

- `packages/editor/src/index.ts` — der `Mention`-Node ist Teil des geteilten
  Schemas (client- und collab-serverseitig identisch, das ist Absicht und muss
  so bleiben) und hat ein `renderText`, sodass eine Erwähnung als `@Name` in
  `textContent` und damit in der Suche landet.
- `apps/web/src/components/editor/mention/index.ts` —
  `createMentionSuggestion(spaceId)`, lädt die Space-Mitglieder, pro Space
  gecacht, nur `subject === "user"`.
- `apps/web/src/components/editor/mention/mention-list.tsx` — Dropdown,
  tastaturbedienbar.
- `apps/web/src/components/editor/rich-text-editor.tsx` — eingebunden.

Was fehlt: Beim Speichern passiert nichts. Es gibt keinen Zustellweg, der auf
ein einzelnes Ereignis reagiert — `packages/api/src/routers/notification.ts`
verwaltet ausschließlich Digest-Einstellungen, und
`packages/api/src/lib/notifications/` ist der periodische Sammler/Renderer.
Eine In-App-Benachrichtigung oder einen Posteingang gibt es nicht.

## Scope

### 1. Erwähnungen extrahieren und diffen

Beim Speichern einer Seite (`packages/api/src/routers/page.ts:716` `update`,
sowie der Projektionspfad aus dem Collab-Server) die Mention-Node-IDs aus dem
ProseMirror-JSON einsammeln.

**Der entscheidende Teil ist das Diffen.** Naiv „alle Erwähnungen im Dokument
benachrichtigen" schickt bei jedem Speichern erneut eine Mail an alle jemals
Erwähnten — und im kollaborativen Editor wird sehr oft gespeichert.
Benachrichtigt wird nur, wer in **dieser** Fassung neu hinzugekommen ist.

Die Vergleichsbasis ist vorhanden: `pageRevision`
(`packages/db/src/schema/wiki/pages.ts:108`) hält den vorherigen `content`.
Falls der Speicherpfad nicht immer eine Revision erzeugt, brauchst du einen
expliziten Merker der bereits benachrichtigten Erwähnungen pro Seite — dann
ist der Vergleich unabhängig von der Revisionsstrategie. Prüf das, bevor du
dich festlegst.

Dasselbe für Kommentare (`packages/api/src/routers/comment.ts`): Erwähnungen
im Kommentartext lösen aus, ein Kommentar-Edit benachrichtigt nur neue.

### 2. Berechtigung prüfen — vor dem Versand

Eine Benachrichtigung ist ein Informationskanal. Ein Erwähnter, der die Seite
nicht lesen darf (Per-Page-ACL, `packages/api/src/lib/access.ts`), bekommt
**nichts** — auch keinen Titel, denn schon der Titel kann vertraulich sein.
Die Mitgliederliste im Dropdown ist space-skaliert, ein Per-Page-Override kann
enger sein.

Ebenso: Selbst-Erwähnungen erzeugen keine Benachrichtigung.

### 3. Zustellung

Neben Erwähnungen gehört fachlich dasselbe für **Antworten auf eigene
Kommentare** hierher (`comment.parentId` existiert,
`packages/db/src/schema/wiki/comments.ts:15`). Beides sind gerichtete
Ereignisse an eine Person, im Gegensatz zum breit gestreuten Digest.

Der Weg hängt an der offenen Entscheidung unten.

### 4. Einstellungen

Wer erwähnt wird, muss das abstellen können. Andockpunkt ist
`apps/web/src/routes/_auth/settings/notifications.tsx` und das Muster
Org-Default + Benutzer-Override aus
`packages/db/src/schema/wiki/notifications.ts` — dessen Kopfkommentar erklärt
die „keine Zeile = erben"-Invariante; halte dich daran, wenn du dort andockst.

## Nicht im Scope

- Erwähnung von Teams oder Rollen (`@team`, `@channel`).
- Erwähnungen in Seitentiteln oder Kommentar-Anhängen.
- Push-Benachrichtigungen, mobile Clients.
- Umbau des Digest-Systems.

## Offene Entscheidung — mit dem Menschen klären, nicht raten

**Wie wird zugestellt?** Drei Optionen, die unterschiedlich viel Ticket sind:

1. **Sofort-Mail.** Kleinster Eingriff, benutzt `sendMail`/`actionMail` aus
   `packages/auth/src/mail.ts`. Aber: SMTP ist optional (Versand ist ohne
   `SMTP_HOST` deaktiviert) — auf einer Instanz ohne SMTP wäre das Feature
   unsichtbar. Und ohne Drosselung ist eine Seite mit 30 Erwähnungen ein
   Mail-Sturm.
2. **In-App-Posteingang.** Neue Tabelle `notification` (Empfänger, Typ,
   Seite/Kommentar, gelesen-Zeitpunkt), Glocke in der Kopfzeile, Router zum
   Abrufen und Als-gelesen-markieren. Funktioniert ohne SMTP, ist das, was
   Nutzer von vergleichbaren Werkzeugen erwarten — aber deutlich mehr Arbeit
   und eine Schema-Änderung.
3. **Beides**, mit Mail als optionalem Zusatz zum Posteingang.

Empfehlung: **2, danach optional 1.** Ein Posteingang ist die Infrastruktur,
die auch alle künftigen gerichteten Ereignisse braucht (Antworten, Zuweisungen,
Freigabeanfragen); reine Sofort-Mails wären ein Sackgassen-Pfad. Aber das ist
eine Produktentscheidung — der Agent trifft sie nicht allein.

## Akzeptanzkriterien

`packages/api/tests/integration/mention.test.ts`:

- Neue Erwähnung beim Speichern → genau eine Benachrichtigung.
- Erneutes Speichern ohne Änderung an den Erwähnungen → **keine** weitere.
- Entfernte und wieder eingefügte Erwähnung → wieder eine.
- Erwähnter ohne Leserecht auf die Seite (Per-Page-Override) → keine
  Benachrichtigung, kein Titel-Leak.
- Selbst-Erwähnung → keine.
- Erwähnung im Kommentar → Benachrichtigung; Kommentar-Edit ohne neue
  Erwähnung → keine.
- Antwort auf eigenen Kommentar → Benachrichtigung an den Elternteil-Autor,
  nicht an sich selbst.
- Abgeschaltete Einstellung unterdrückt die Zustellung.
- Zehn Erwähnungen derselben Person in einem Speichervorgang → eine
  Benachrichtigung, nicht zehn.

## Migrations-Koordination

Bei Variante 2 oder 3 legt dieses Ticket eine Tabelle an. Dann gilt
`tickets/README.md`: Schema-Commit zuletzt, vor `pnpm db:generate` rebasen.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
