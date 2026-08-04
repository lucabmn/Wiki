# T09 — Inline-Kommentare

**Ziel:** Kommentare hängen an einer Textstelle statt nur an der Seite —
markieren, kommentieren, im Rand anzeigen, auflösen.

## Ist-Zustand

Die Server-Seite ist vorbereitet — dieses Ticket ist im Kern Editor-Arbeit:

- `packages/db/src/schema/wiki/comments.ts:24` — `comment.anchor` als `jsonb`,
  kommentiert mit „Optional anchor into the doc for inline/margin comments".
- `packages/api/src/schemas/comment.ts` — `AnchorSchema`, im Create-Input und
  im Output vorhanden.
- `packages/api/src/routers/comment.ts` — `anchor: input.anchor ?? null` wird
  gespeichert. Der Server behandelt den Anker als **opakes JSON**; er
  interpretiert ihn nicht.
- `comment.parentId`, `resolvedAt`, `resolvedBy`, `deletedAt` existieren.
- `apps/web/src/components/editor/page-aside.tsx` — Seitenrail, hier hängen
  Kommentare heute.

Es gibt keine Editor-Mark, keine Rand-Darstellung, kein Ankern.

## Die harte Randbedingung: das Dokument ist ein CRDT

Das ist der Punkt, an dem eine naive Umsetzung scheitert.

`page.yjsState` (`packages/db/src/schema/wiki/pages.ts:41-45`) ist ein Yjs-CRDT,
der Live-Zustand während des Bearbeitens; `apps/collab` projiziert ihn zurück
nach `content`. Ein Anker als absolute Position (`{from: 120, to: 145}`) ist
damit **sofort falsch**: Jede Einfügung eines anderen Nutzers oberhalb der
Stelle verschiebt sie, und der Kommentar landet an beliebigem Text.

Zwei tragfähige Wege:

1. **Yjs Relative Positions** (`Y.createRelativePositionFromTypeIndex` /
   `createAbsolutePositionFromRelativePosition`). Genau dafür gemacht,
   überleben nebenläufige Bearbeitung. Der serialisierte relative Anker ist
   das, was in `comment.anchor` landet.
2. **ProseMirror-Mark mit Kommentar-ID im Dokument.** Der Anker ist dann Teil
   des Dokuments und wandert mit dem Text mit — dann muss die Mark aber ins
   **geteilte** Schema (`packages/editor/src/index.ts`, siehe unten), sonst
   verwirft der Collab-Server sie beim Projizieren.

Weg 2 ist robuster gegen Textverschiebungen, koppelt Kommentare aber ans
Dokument (Löschen der Mark = Anker weg). Weg 1 hält beides getrennt.
**Entscheide bewusst und begründe es im Code-Kommentar.**

**Wie bei T08 gilt:** Alles, was zum ProseMirror-Schema gehört — insbesondere
eine Kommentar-Mark — muss in `packages/editor/src/index.ts`, weil der
Collab-Server dasselbe Schema benutzt. Der Kommentar am `Mention`-Node sagt das
ausdrücklich.

## Scope

### 1. Ankern

- Anker-Format festlegen und **versionieren** (`{v: 1, …}`) — der erste
  Versuch wird nicht der letzte sein, und in der Datenbank liegen dann alte
  Anker.
- Erzeugen beim Markieren einer Auswahl, Auflösen beim Rendern.
- **Verwaistes Verhalten definieren und implementieren:** Wird der annotierte
  Text gelöscht, ist der Anker unauflösbar. Der Kommentar darf nicht
  verschwinden (er ist Inhalt und steht im Audit) und nicht an falscher Stelle
  auftauchen. Vorschlag: als „verwaist" markiert in der Rail anzeigen, mit dem
  ursprünglich zitierten Text. Dafür beim Anlegen einen **Textauszug** im Anker
  mitspeichern — ohne den ist ein verwaister Kommentar für den Leser sinnlos.

### 2. Editor-UI

- Auswahl treffen → Bubble-Menü „Kommentieren".
- Annotierter Text ist hervorgehoben; Klick fokussiert den Kommentar in der Rail
  und umgekehrt.
- Überlappende Anker müssen darstellbar sein (zwei Kommentare auf sich
  überschneidenden Bereichen sind normal, nicht die Ausnahme).
- Rand-/Rail-Darstellung neben dem Text, gruppiert nach Position im Dokument,
  nicht nach Erstellungszeit.
- Aufgelöste Kommentare werden ausgeblendet und sind einblendbar.
- Auch in der Read-Only-Ansicht (`page-content.tsx`) müssen Inline-Kommentare
  sichtbar sein — die meisten Leser öffnen den Editor nie.

### 3. Berechtigungen

Vorhandene Logik unverändert benutzen: Kommentieren erfordert die Rolle
`commenter` (`packages/db/src/schema/wiki/enums.ts`, `wikiRole`), Auflösen und
Moderieren laufen über die bestehende Autor-oder-Berechtigung-Prüfung in
`packages/api/src/routers/comment.ts`. **Kein neues Berechtigungsmodell.**

Ein Nutzer mit reinem Leserecht sieht Inline-Kommentare, kann aber keine
anlegen — prüf, dass die UI das korrekt abbildet.

### 4. Verträglichkeit mit Vorhandenem

- Seitenweite Kommentare (`anchor === null`) funktionieren unverändert weiter
  und erscheinen weiterhin unter dem Dokument. Beide Arten koexistieren.
- Threads (`parentId`) gelten auch für Inline-Kommentare.
- Erwähnungen in Inline-Kommentaren verhalten sich wie in T07 beschrieben —
  falls T07 parallel läuft, kurz abstimmen.

## Nicht im Scope

- Vorschlagsmodus / Änderungsverfolgung („suggesting").
- Kommentare an Bildern, Tabellenzellen oder Anhängen.
- Kommentar-Reaktionen (Emoji).
- Kommentare auf einer bestimmten Revision.

## Offene Entscheidung

Nur die Anker-Strategie (Weg 1 vs. Weg 2 oben). Sie ist rein technisch, aber
kaum reversibel, sobald Anker in der Datenbank liegen — deshalb vor der
Implementierung festhalten, nicht danach.

## Akzeptanzkriterien

`apps/web/tests/`:

- Anker über Serialisieren → Deserialisieren stabil.
- **Der entscheidende Test:** Client A setzt einen Kommentar auf ein Wort,
  Client B fügt gleichzeitig davor Text ein — der Anker zeigt danach noch auf
  dasselbe Wort. Ohne diesen Test ist das Feature nicht abgenommen.
- Wird der annotierte Text gelöscht, erscheint der Kommentar als verwaist mit
  dem ursprünglichen Textauszug — er verschwindet nicht und springt nicht.
- Zwei überlappende Anker werden beide dargestellt.
- Anker in einer alten Version (`{v: 1}`) bleibt lesbar, wenn das Format wächst.

`packages/api/tests/integration/comment.test.ts` (erweitern):

- Kommentar mit Anker wird gespeichert und unverändert zurückgegeben (der
  Server interpretiert ihn nicht).
- Kommentar ohne Anker verhält sich wie bisher.
- Rolle `viewer` bekommt beim Anlegen `FORBIDDEN`, `commenter` nicht.
- Auflösen und Löschen funktionieren für Inline-Kommentare wie für seitenweite.

## Migrations-Koordination

Keine Schema-Änderung an der Datenbank — `comment.anchor` existiert. Aber
`packages/editor/src/index.ts` wird auch von T08 angefasst; Diffs klein halten.

## Gate

`pnpm check`, `turbo run check-types`, `turbo run test` — grün.
