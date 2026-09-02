#!/usr/bin/env bun
/**
 * Bibelstudium-MCP-Server: wortgetreue Bibelarbeit über eine lokale
 * SQLite-Datenbank.
 *
 * Sieben Werkzeuge (wortgetreue deutsche Verse, Morphologie des Grundtextes,
 * Konkordanz, Querverweise, Volltextsuche, Editionsvergleich, Serverauskunft),
 * dazu `bible_setup` nur über stdio, drei geführte Prompts sowie Ressourcen
 * samt URI-Vorlagen. Deutsche Ausgabefelder, englische Werkzeugnamen.
 *
 * Übersetzungen: vier frei lizenzierte deutsche Ausgaben (siehe
 * translations.ts), voreingestellt Luther 1912. Die Daten entstehen lokal über
 * die download-*.ts-Skripte.
 *
 * Aufbau der Datei: Ausgabeschemata, Werkzeug-Registrierung, Prompts,
 * Ressourcen, bible_setup, bible_server_info, Dispatch, Bootstrap. Die
 * beiden genannten Werkzeuge bleiben hier, weil sie keinen Text lesen: das
 * eine baut die Datenbank, das andere beschreibt die Instanz. Die übrigen stehen
 * nicht mehr hier: Jeder Handler hat eine eigene Datei unter handlers/, und was
 * mehrere von ihnen brauchen, steht in werkzeug-helfer.ts. Die
 * Datenbankverbindung samt allen vorbereiteten Statements steht in db.ts, die
 * Editionen in editions.ts.
 *
 * Was hier bleibt, bleibt aus einem Grund: Die Ausgabeschemata gehören neben
 * die Werkzeugliste, die sie deklariert, und der Dispatch ist der Ort, an dem
 * die Werkzeuge zusammenlaufen, nicht eines von ihnen.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolRequest,
  CallToolResult,
  GetPromptRequest,
  ReadResourceRequest,
} from "@modelcontextprotocol/sdk/types.js";
import packageJson from "../package.json";
import { DB_PATH } from "./db-path.ts";
import {
  WERKZEUG_NAMEN,
  bilanzZeile,
  registrierePrompts,
  registriereProzess,
  registriereRessourcen,
  registriereWerkzeuge,
  zaehlePrompt,
  zaehleRessource,
  zaehleWerkzeug,
} from "./metriken.ts";
import { serveHttp, serveMetrics } from "./transport.ts";
import {
  HTTP_MODE,
  SETUP_CLI,
  availableEditions,
  availableTranslations,
  bookCount,
  dataFetchedAt,
  dataMissing,
  hasFts,
  hasStepCols,
  hasStrongDefs,
  hasTagnt,
  hasVerseNotes,
  hasParallels,
  hasXrefs,
  originalEditions,
  stmtBooks,
} from "./db.ts";
import {
  DATASET_QUELLEN,
  EDITION_META,
  NT_EDITION_ORDER,
  quellen,
  translationQuelle,
} from "./editions.ts";
import {
  TRANSLATIONS,
  type TranslationCode,
} from "./translations.ts";
import {
  type LimitGrenzen,
  MAX_BOOK_LENGTH,
  MAX_CHAPTER,
  MAX_VERSE,
  MAX_VERSES_LENGTH,
  MAX_VERSE_PARTS,
  bookNotFoundMessage,
  bookTooLong,
  chapterOutOfRange,
  EFFECTIVE_DEFAULT_TRANSLATION,
  errorResult,
  jsonResult,
  lookupPayload,
  originalPayload,
  requireTranslation,
  resolveBook,
  rpcError,
  toInt,
  verseOutOfRange,
  reversedVerseRange,
  unparsableVersePart,
  versesNotParsable,
  versesReversedRange,
  versesOutOfBounds,
  versesTooLong,
  versesTooManyParts,
} from "./werkzeug-helfer.ts";
import { handleCompare } from "./handlers/compare.ts";
import { CONCORDANCE_LIMIT, handleConcordance } from "./handlers/concordance.ts";
import { XREF_LIMIT, handleCrossrefs } from "./handlers/crossrefs.ts";
import { handleLookup } from "./handlers/lookup.ts";
import { handleOriginal } from "./handlers/original.ts";
import { SEARCH_LIMIT, handleSearch } from "./handlers/search.ts";

/** Die eine Versionsangabe, aus der auch das MCPB-Manifest gebaut wird. */
const PACKAGE_VERSION: string = packageJson.version;

// --- Ausgabeschemata: eines je Lesewerkzeug --------------------------------
// Deklariert, damit ein konsumierendes Programm ein Feld finden kann, statt
// Prosa zu zerlegen, und damit `structuredContent` etwas hat, woran es geprüft
// wird.
//
// Für alle gelten zwei Regeln, und beide tragen:
//
// 1. `required` nennt NUR Felder, die in jedem Erfolgspfad dastehen. Für einen
//    Client des 1.x-SDK ist ein deklariertes Schema strenger als gar keines:
//    Eine erfolgreiche Antwort, die nicht passt, wird rundweg abgewiesen
//    (client/index.js:500), wo sie vorher bloß eine Antwort mit einem fehlenden
//    Feld war. Jeder Eintrag unten benennt deshalb die Bedingung, unter der das
//    Feld fehlt, und tests/test-golden.ts trägt je Bedingung einen Fall.
//    `required` ohne einen passenden Fall zu erweitern ist der Weg, aus dieser
//    Stelle einen Ausfall zu machen.
// 2. Nirgends `additionalProperties: false`. Ein Ausgabefeld zu ergänzen muss
//    eine nicht brechende Änderung bleiben, das ist die Hausregel dieser
//    Schnittstelle.
//
// Feldbeschreibungen stehen sparsam und nur dort, wo ein Konsument gemessen
// danebengegriffen hat (Zahlen, Vorbehalte, Quellentreue). Ob eine Beschreibung
// innerhalb eines Ausgabeschemas ein Modell überhaupt erreicht, ist NICHT
// belegt, anders als die am Werkzeug selbst, für die es belegt ist (siehe
// bible_lookup).

/** In jeder Antwort gleich, deshalb einmal deklariert. `nennung: null` heißt,
 *  die Lizenz verlangt keine Nennung; das ist eine Aussage, kein fehlender Wert. */
const QUELLEN_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      werk: { type: "string" },
      lizenz: { type: "string" },
      nennung: { type: ["string", "null"] },
    },
    required: ["werk", "lizenz", "nennung"],
  },
};

/** In drei Werkzeugen dieselbe Gestalt, deshalb einmal deklariert: die Auskunft
 *  darüber, dass die Wortlaut-Grenze einer Ausgabe gegriffen hat. Sie steht
 *  neben dem Satz im `hinweis` und nicht an seiner Stelle, denn der Satz ist für
 *  das Modell geschrieben und diese drei Zahlen für den, der nachrechnet.
 *  `ohne_wortlaut` meint zwei verschiedene Lagen, und welche vorliegt, sagt der
 *  `hinweis`: In `bible_lookup` fehlen diese Verse ganz, in `bible_search` und
 *  `bible_crossrefs` steht ihre Stellenangabe da, nur ohne Text. */
const GEKUERZT_SCHEMA = {
  type: "object",
  properties: {
    verse_max: {
      type: "integer",
      description: "Maximum number of verses this edition may quote per call.",
    },
    im_wortlaut: { type: "integer" },
    ohne_wortlaut: { type: "integer" },
    fussnoten_gezeigt: {
      type: "integer",
      description:
        "Only in bible_lookup, and only when the edition's notes hit the same cap; " +
        "the notes have their own budget of the same size.",
    },
    fussnoten_entfallen: { type: "integer" },
  },
  required: ["verse_max", "im_wortlaut", "ohne_wortlaut"],
};

/** Die Gestalt von `gekuerzt` in bible_crossrefs allein: dieselben Zahlen wie
 *  oben, dazu drei zu den Parallelstellen, weil deren Teilbudget greifen kann,
 *  ohne dass das Hauptbudget es merkt (`verse-budget.ts`). Als eigenes Schema
 *  und nicht im geteilten, damit lookup und search nicht drei Felder
 *  versprechen, die sie nie tragen. Die drei gingen vom 22.08. bis zum
 *  02.09.2026 undeklariert hinaus, golden-getestet und trotzdem unbemerkt,
 *  weil der Prüfer nur deklarierte Schlüssel ansah; seither meldet er jedes
 *  nicht deklarierte Feld. */
const CROSSREFS_GEKUERZT_SCHEMA = {
  ...GEKUERZT_SCHEMA,
  properties: {
    ...GEKUERZT_SCHEMA.properties,
    parallelen_max: {
      type: "integer",
      description:
        "Only when the parallel passages hit their own, smaller budget; the " +
        "share of verse_max they may use at most.",
    },
    parallelen_gezeigt: { type: "integer" },
    parallelen_entfallen: { type: "integer" },
  },
};

/** Bedingt, drei Felder:
 *  `hinweis`, aus fünf Quellen (`lookupPayload`): Wortlaut-Grenze,
 *  Fußnotenbudget, abweichende Verszählung (140 der 1190 Kapitel),
 *  Namensnennung der Ausgabe (Schlachter 1951 und 2000, also dort in jeder
 *  Antwort) und Wörter in Klammern (Menge 148 Verse, Schlachter 2000 1925).
 *  Bis zum 02.09.2026 nannte dieser Kommentar zwei davon.
 *  `fussnoten`, nur wenn die Ausgabe zu einem der gelieferten Verse eine
 *  Anmerkung führt: allein Schlachter 2000, dort an 1134 von 31 171 Versen
 *  (rund 3,6 %, gemessen 05.08.2026). Die Noten haben ein eigenes Budget
 *  derselben Größe wie die Verse; es greift beim heutigen Bestand nie (höchstens
 *  15 Noten je Kapitel, 12 innerhalb der ersten 20 Verse, 3 je Vers), und
 *  `gekuerzt.fussnoten_gezeigt`/`fussnoten_entfallen` stehen deshalb bisher in
 *  keiner Antwort.
 *  `gekuerzt`, nur wenn die Ausgabe eine Wortlaut-Grenze hat und diese Antwort
 *  an sie stieß. Betroffen sind die Kapitel oberhalb ihrer Grenze; bei der heute
 *  eingetragenen Zahl sind das 768 der 1189 Kapitel in der Schlachter 2000 und
 *  765 in der Schlachter 1951 (gemessen 05.08.2026). Luther,
 *  Elberfelder und Menge kennen die Bedingung nicht, dort fehlt das Feld in
 *  jeder Antwort. Auf dem Ressourcenpfad ist es wie `verse_einzeln` gar nicht
 *  deklariert: Ressourcen werden gegen kein `outputSchema` geprüft. */
const LOOKUP_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    kurzref: {
      type: "string",
      description:
        "Same reference in the short German citation form (\"2Kor 8,9.13-15\"). Copy this " +
        "into prose; `reference` spells the book out and is not the citation form.",
    },
    translation: { type: "string" },
    text: { type: "string" },
    hinweis: { type: "string" },
    fussnoten: {
      type: "array",
      items: {
        type: "object",
        properties: {
          vers: { type: "number" },
          stelle: { type: "string" },
          text: { type: "string" },
        },
        required: ["vers", "stelle", "text"],
      },
    },
    gekuerzt: GEKUERZT_SCHEMA,
    quellen: QUELLEN_SCHEMA,
  },
  // `text` bleibt erforderlich: Der Leerfall ist vorher abgefangen, und die
  // Wortlaut-Grenze lässt immer mindestens einen Vers durch.
  required: ["reference", "kurzref", "translation", "text", "quellen"],
};

/** Bedingt: `woerter[].strong`, fehlt bei allen 137 554 SBLGNT-Wörtern und bei
 *  5951 WLC-Wörtern; byzantine und tr führen es durchgängig. */
const ORIGINAL_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    kurzref: {
      type: "string",
      description:
        "Same reference in the short German citation form (\"2Kor 8,9.13-15\"). Copy this " +
        "into prose; `reference` spells the book out and is not the citation form.",
    },
    texttyp: { type: "string" },
    edition: { type: "string" },
    sprache: { type: "string" },
    hinweis: { type: "string" },
    woerter: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wort: {
            type: "string",
            description:
              "Verbatim from the edition: byzantine/tr unaccented, sblgnt accented, wlc with " +
              "cantillation marks and the OSHB morpheme separator. Quote as is; do not add " +
              "accents and do not smooth characters away.",
          },
          grundform: { type: "string" },
          morphologie: { type: "string" },
          code: { type: "string" },
          strong: { type: "string" },
        },
        required: ["wort", "grundform", "morphologie", "code"],
      },
    },
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "kurzref", "texttyp", "edition", "sprache", "hinweis", "woerter", "quellen"],
};

/** Bedingt: `verweise[].verse_einzeln`, nur bei einem mehrversigen Ziel innerhalb
 *  eines Kapitels; `lesehinweis`, nur wenn ein Verweis ihn trägt; `hinweis` bei
 *  Wörtern in Klammern, wenn `limit` die Liste geschnitten hat oder wenn die
 *  Wortlaut-Grenze gegriffen hat. `gesamt` steht in jeder Erfolgsantwort und
 *  meint die Zahl der vorhandenen Verweise, nicht die der gelieferten: Bis zum
 *  06.08.2026 gab es sie nicht, und eine auf 10 von 62 geschnittene Antwort sah
 *  vollständig aus.
 *  `verweise[].text` fehlt ab dem Verweis, mit dem die Wortlaut-Grenze der
 *  Ausgabe erschöpft ist, und dann bei allen folgenden; nur in Schlachter 1951
 *  und Schlachter 2000, in den drei gemeinfreien Ausgaben steht es in jeder
 *  Antwort. Bei `limit: 30` überschreiten 8941 der 29 364 möglichen Abrufe die
 *  Grenze, bei der Vorgabe `limit: 10` sind es 1053 (gemessen 05.08.2026).
 *  `gekuerzt` wie in bible_lookup, um drei Zahlen zu den Parallelstellen
 *  erweitert.
 *  `parallelen` steht nur, wo die UBS-Datenbank eine Gruppe zu diesem Vers
 *  führt: bei 5687 der 29 364 Verse mit Verweisen (gemessen 22.08.2026), und
 *  gar nicht, solange download-parallels.ts nicht gelaufen ist. Innerhalb einer
 *  Stelle ist `zaehlung_abweichend` bedingt (nur im Alten Testament, und nur
 *  wenn der hebräische Grundtext geladen ist), `text` und `verse_einzeln` wie
 *  bei den Verweisen.
 *  `lesehinweis` erscheint jetzt auch, wenn allein eine Parallelstelle
 *  mehrversig ist. */
const CROSSREFS_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    kurzref: {
      type: "string",
      description:
        "Same reference in the short German citation form (\"2Kor 8,9.13-15\"). Copy this " +
        "into prose; `reference` spells the book out and is not the citation form.",
    },
    gesamt: {
      type: "integer",
      description:
        "Number of references that exist for this verse, independent of `limit`. " +
        "Larger than `verweise.length` means the list was cut; take this number, do not " +
        "derive one from the list.",
    },
    verweise: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stelle: { type: "string" },
          votes: { type: "integer" },
          text: {
            type: "string",
            description:
              "Absent once the edition's verbatim quota for this response is used up, and " +
              "absent for every later entry; also absent when the target verse is missing " +
              "from this translation. `stelle` and `votes` are always there.",
          },
          verse_einzeln: {
            type: "array",
            items: {
              type: "object",
              properties: { nr: { type: "integer" }, text: { type: "string" } },
              required: ["nr", "text"],
            },
            description:
              "One entry per verse, without embedded verse numbers. Quote the verses in full " +
              "from here; the joined `text` gets cut at both ends when consumers split it.",
          },
          // Bedingt: nur wo der Abschnitt weiter reicht als die gelieferten
          // Verse. Nicht zu verwechseln mit dem `gekuerzt` der Antwort, das die
          // Wortlaut-Grenze der Ausgabe meldet und in Versen rechnet.
          abschnitt_gekuerzt: {
            type: "object",
            properties: {
              verse_gezeigt: { type: "integer" },
              verse_gesamt: {
                type: "integer",
                description:
                  "Length of the whole span. Absent when the target crosses a chapter " +
                  "boundary, where only the first verse is carried and the full length is " +
                  "not established here; `stelle` states how far the target reaches.",
              },
            },
            required: ["verse_gezeigt"],
            description:
              "Present only when `text`/`verse_einzeln` cover fewer verses than `stelle` " +
              "names. Quote against `verse_gezeigt`, not against `stelle`.",
          },
        },
        required: ["stelle", "votes"],
      },
    },
    parallelen: {
      type: "object",
      properties: {
        gruppen: {
          type: "array",
          items: {
            type: "object",
            properties: {
              stellen: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    stelle: { type: "string" },
                    locator: {
                      type: "string",
                      description:
                        "The reference exactly as the UBS source writes it (USFM book code). " +
                        "In the Old Testament the source counts verses after the Hebrew Bible " +
                        "while this server follows its German editions; where the two differ, " +
                        "this string is authoritative and `stelle` is the resolved approximation.",
                    },
                    sprache: { type: "string" },
                    zaehlung_abweichend: {
                      type: "boolean",
                      description:
                        "Present and true only where the Hebrew text and the requested edition " +
                        "count this chapter differently, so `stelle` may be off by a verse or " +
                        "more. Absence is not a clearance: it also means the check could not " +
                        "run because the Hebrew text is not loaded.",
                    },
                    text: {
                      type: "string",
                      description:
                        "Absent once the verbatim quota reserved for parallels is used up, and " +
                        "absent when the verses are missing from this translation.",
                    },
                    verse_einzeln: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { nr: { type: "integer" }, text: { type: "string" } },
                        required: ["nr", "text"],
                      },
                    },
                  },
                  required: ["stelle", "locator", "sprache"],
                },
              },
            },
            required: ["stellen"],
          },
        },
        stellen: {
          type: "integer",
          description: "Number of parallel places across all groups, the queried verse excluded.",
        },
      },
      required: ["gruppen", "stellen"],
      description:
        "Present only when the UBS Parallel Passage Database lists this verse. A group is an " +
        "unordered set with no direction and no ranking, unlike `verweise`; a verse can belong " +
        "to more than one group.",
    },
    lesehinweis: { type: "string" },
    hinweis: { type: "string" },
    gekuerzt: CROSSREFS_GEKUERZT_SCHEMA,
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "kurzref", "gesamt", "verweise", "quellen"],
};

/** Bedingt: die sechs Lexikonfelder (`strong`, `umschrift`, `kurzbedeutung`,
 *  `bedeutung`, `kjv_woerter`, `lexikon`; das letzte gibt es nur im
 *  Griechischen, und alle setzen voraus, dass strong_defs geladen ist und einen
 *  Eintrag führt), sowie `hinweis`: Er trägt die Kürzung durch `limit` und, wenn
 *  `kjv_woerter` dasteht, den Satz zu dessen Herkunft; beides zugleich ist
 *  möglich. */
const CONCORDANCE_OUTPUT = {
  type: "object" as const,
  properties: {
    suche: { type: "string" },
    grundform: { type: "string" },
    strong: { type: "string" },
    umschrift: { type: "string" },
    kurzbedeutung: { type: "string" },
    bedeutung: { type: "string" },
    kjv_woerter: {
      type: "string",
      description:
        "English renderings the King James Version uses for this word. A statement about " +
        "that translation, not about the Greek or Hebrew word itself.",
    },
    lexikon: { type: "string" },
    texttyp: { type: "string" },
    edition: { type: "string" },
    gesamt: {
      type: "integer",
      description: "Occurrences of the word, exact. Counts are never capped by `limit`.",
    },
    verse: { type: "integer", description: "Distinct verses containing it, exact." },
    buecher: {
      type: "array",
      items: {
        type: "object",
        properties: { buch: { type: "string" }, anzahl: { type: "integer" } },
        required: ["buch", "anzahl"],
      },
      description: "Full distribution over all occurrences, not only the listed ones.",
    },
    vorkommen: {
      type: "array",
      items: {
        type: "object",
        properties: { stelle: { type: "string" }, wort: { type: "string" } },
        required: ["stelle", "wort"],
      },
    },
    hinweis: { type: "string" },
    quellen: QUELLEN_SCHEMA,
  },
  required: [
    "suche", "grundform", "texttyp", "edition", "gesamt", "verse", "buecher", "vorkommen", "quellen",
  ],
};

/** Bedingt: `vorkommen_gesamt`, nur wenn gezählt wurde UND die Zahl von
 *  `treffer` abweicht; `verteilung`, nur wenn gezählt wurde und es mehr als eine
 *  Gruppe gibt. Beide entfallen oberhalb von OCCURRENCE_SCAN_LIMIT, und
 *  `hinweis` sagt das dann.
 *  `verse[].text` fehlt jenseits der Wortlaut-Grenze der Ausgabe: In Schlachter
 *  1951 und Schlachter 2000 tragen die ersten gelisteten Treffer bis zu dieser
 *  Grenze ihren Text, alle weiteren allein die Stellenangabe. Sichtbar wird das
 *  nur, wenn `limit` über der Grenze liegt; die Vorgabe ist 10 und liegt darunter.
 *  Bei der heute eingetragenen Zahl haben in der Schlachter 1951 2564 von 25 844
 *  Wörtern mehr Treffer als erlaubt (9,9 %). `gekuerzt` wie in bible_lookup. */
const SEARCH_OUTPUT = {
  type: "object" as const,
  properties: {
    suche: { type: "string" },
    uebersetzung: { type: "string" },
    treffer: {
      type: "integer",
      description:
        "Number of matching VERSES, not of word occurrences: a verse can match several times.",
    },
    vorkommen_gesamt: {
      type: "integer",
      description:
        "Number of word occurrences across all matching verses. Absent when the occurrences " +
        "were not counted (see `hinweis`); do not estimate it in that case.",
    },
    verteilung: {
      type: "array",
      items: {
        type: "object",
        properties: {
          buch: { type: "string" },
          kapitel: { type: "integer" },
          treffer: { type: "integer" },
          vorkommen: { type: "integer" },
        },
        required: ["treffer", "vorkommen"],
      },
      description:
        "Counted over all hits, not over the listed verses. Carries `buch` for a whole-Bible " +
        "search and `kapitel` when restricted to one book. Take these numbers; do not derive " +
        "them from the result list.",
    },
    verse: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stelle: { type: "string" },
          text: {
            type: "string",
            description:
              "Absent beyond the edition's verbatim quota; the hit still counts towards `treffer`.",
          },
        },
        required: ["stelle"],
      },
    },
    hinweis: { type: "string" },
    gekuerzt: GEKUERZT_SCHEMA,
    quellen: QUELLEN_SCHEMA,
  },
  required: ["suche", "uebersetzung", "treffer", "verse", "hinweis", "quellen"],
};

/** Bedingt: `warnung` und `quellenkonflikte`, nur wenn die TAGNT-Bezeugung dem
 *  Editionstext widerspricht; `bezeugung`, nur wenn TAGNT den Vers kennt (neun
 *  NT-Verse haben überhaupt keine Zeile, dann steht `bezeugung_fehlt` da), und
 *  darin `lesehinweis`, `bedeutungsvariante`, `schreibvariante`, `in_dieser_db`,
 *  `abgleich`.
 *  `vergleiche[]` hat zwei Gestalten, deshalb ist allein `paar` erforderlich. */
const COMPARE_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
    kurzref: {
      type: "string",
      description:
        "Same reference in the short German citation form (\"2Kor 8,9.13-15\"). Copy this " +
        "into prose; `reference` spells the book out and is not the citation form.",
    },
    sprache: { type: "string" },
    warnung: {
      type: "string",
      description:
        "The TAGNT attestation contradicts the edition text here. Belongs in the answer about " +
        "this verse, not in a footnote.",
    },
    quellenkonflikte: {
      type: "array",
      items: { type: "string" },
      description:
        "Per affected form, what the edition actually reads. The edition text governs, not the " +
        "TAGNT note.",
    },
    bezeugung_fehlt: {
      type: "string",
      description:
        "Why `bezeugung` is absent for this verse. A gap in the source, not a statement " +
        "about the verse.",
    },
    editionen: {
      type: "array",
      items: {
        type: "object",
        properties: {
          texttyp: { type: "string" },
          edition: { type: "string" },
          woerter: { type: "integer" },
          text: { type: "string" },
        },
        required: ["texttyp", "edition", "woerter", "text"],
      },
    },
    vergleiche: {
      type: "array",
      items: {
        type: "object",
        properties: {
          paar: { type: "string" },
          ergebnis: { type: "string" },
          unterschiede: { type: "array", items: { type: "string" } },
        },
        required: ["paar"],
      },
    },
    bezeugung: {
      type: "object",
      properties: {
        quelle: { type: "string" },
        woerter_gesamt: { type: "integer" },
        von_allen_acht_bezeugt: { type: "integer" },
        lesehinweis: { type: "string" },
        abweichend: {
          type: "array",
          items: {
            type: "object",
            properties: {
              wort: { type: "string" },
              typ: { type: "string" },
              editionen: { type: "string" },
              bedeutungsvariante: { type: "string" },
              schreibvariante: { type: "string" },
              in_dieser_db: {
                // Dynamische Schlüssel: einer je bezeugter Wortform.
                type: "object",
                additionalProperties: { type: "array", items: { type: "string" } },
                description:
                  "Which of the loaded editions actually reads which form. Governs over the " +
                  "TAGNT note for the question what an edition reads.",
              },
              abgleich: {
                type: "array",
                items: { type: "string" },
                description: "Where the TAGNT note and the edition text disagree.",
              },
            },
            required: ["wort", "typ", "editionen"],
          },
        },
      },
      required: ["quelle", "woerter_gesamt", "von_allen_acht_bezeugt", "abweichend"],
    },
    hinweis: { type: "string" },
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "kurzref", "sprache", "editionen", "vergleiche", "hinweis", "quellen"],
};

/** Bedingt: `daten_stand`, erst wenn ein Download eine Herkunft vermerkt hat;
 *  `hinweis`, nur solange die Datenbank fehlt; `kanon` nur mit Datenbank;
 *  `zusatzdaten.strong_lexikon_sprache` nur mit geladenem Lexikon; die drei
 *  Lizenzfelder in `uebersetzungen[]` nur bei einem Kürzel mit Registry-Eintrag. */
const SERVER_INFO_OUTPUT = {
  type: "object" as const,
  properties: {
    server: { type: "string" },
    version: { type: "string" },
    uebersetzungen: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          name: { type: "string" },
          lizenz: { type: "string" },
          nennung: { type: ["string", "null"] },
          verse_max: {
            type: ["number", "null"],
            description:
              "Maximum verses this edition may be quoted verbatim in one call; " +
              "null means no such limit.",
          },
        },
        required: ["code", "name"],
      },
    },
    // Steht in jedem Erfolgspfad und gehört deshalb nach `required`.
    voreinstellung: {
      type: "string",
      description: "Translation code used when a call omits `translation`.",
    },
    urtext_editionen: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, name: { type: "string" } },
        required: ["code", "name"],
      },
    },
    zusatzdaten: {
      type: "object",
      properties: {
        strong_lexikon: { type: "boolean" },
        strong_lexikon_vollstaendig: { type: "boolean" },
        strong_lexikon_sprache: {
          type: "string",
          description: "Language of the lexicon entries, present only if a lexicon is loaded.",
        },
        editionsbezeugung: { type: "boolean" },
        querverweise: { type: "boolean" },
        parallelstellen: { type: "boolean" },
        volltextsuche: { type: "boolean" },
        fussnoten: { type: "boolean" },
      },
      required: [
        "strong_lexikon", "strong_lexikon_vollstaendig", "editionsbezeugung",
        "querverweise", "parallelstellen", "volltextsuche", "fussnoten",
      ],
    },
    ressourcen: {
      type: "object",
      properties: {
        statisch: { type: "array", items: { type: "string" } },
        vorlagen: { type: "array", items: { type: "string" } },
      },
      required: ["statisch", "vorlagen"],
    },
    kanon: {
      type: "object",
      properties: {
        buecher: { type: "number" },
        umfang: { type: "string" },
      },
      required: ["buecher", "umfang"],
    },
    daten_stand: {
      type: "string",
      description: "Date of the most recent source download, not a deployment date.",
    },
    hinweis: { type: "string" },
  },
  required: [
    "server", "version", "uebersetzungen", "voreinstellung", "urtext_editionen", "zusatzdaten",
    "ressourcen",
  ],
};

// Die sieben Lesewerkzeuge lesen nur: eine lokale SQLite-Datei, nur lesend
// geöffnet, keine Schreibvorgänge, keine Nebenwirkungen, kein Netz. Beide
// Vorgabewerte der Spezifikation sind hier falsch (readOnlyHint steht auf false,
// openWorldHint auf true), deshalb stehen beide ausdrücklich da. destructiveHint
// und idempotentHint bleiben bewusst draußen: Das Schema erklärt sie nur dann
// für bedeutsam, wenn readOnlyHint false ist.
const READ_ONLY_LOCAL = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * Das `translation`-Argument, aus der wirksamen Voreinstellung erzeugt.
 *
 * `default` in einem `inputSchema` ist nicht bloß Beschreibung: Ein Client darf
 * daraus einen weggelassenen Wert materialisieren und ihn ausdrücklich senden.
 * Stünde hier ein festes "LUT", während `EFFECTIVE_DEFAULT_TRANSLATION` etwas
 * anderes sagt, machte genau das die Einstellung des Endpunkts wirkungslos, und
 * kein Testlauf würde rot (gemessen 06.08.2026: drei Werkzeuge deklarierten
 * "LUT", während das Verhalten bereits Schlachter 2000 war). Deshalb wird beides
 * hier abgeleitet und nirgends zweimal hingeschrieben.
 */
function translationArg(zweck: string) {
  return {
    type: "string" as const,
    description:
      `${zweck} ` +
      (Object.keys(TRANSLATIONS) as TranslationCode[])
        .map((c) => `"${c}" (${TRANSLATIONS[c].name})`)
        .join(", ") +
      `. Default: "${EFFECTIVE_DEFAULT_TRANSLATION}" ` +
      `(${TRANSLATIONS[EFFECTIVE_DEFAULT_TRANSLATION].name}). ` +
      `Aliases like "luther", "schlachter" accepted. ` +
      `Only editions this instance actually loaded can be requested; ` +
      `bible_server_info lists them.`,
    default: EFFECTIVE_DEFAULT_TRANSLATION,
  };
}

/**
 * Das `limit`-Argument eines Werkzeugs, aus dessen `LimitGrenzen` erzeugt.
 * Dasselbe Muster wie `translationArg()`: Beschreibung, `default` und die
 * Klemmung im Handler lesen zwei Zahlen aus einer Quelle. Kein `maximum:` im
 * Schema, mit Absicht: Ein Client, der es durchsetzte, wiese `limit: 1000` ab,
 * statt die Klemmung samt Hinweis zu bekommen.
 */
function limitArg(zweck: string, grenzen: LimitGrenzen, nachsatz = "") {
  return {
    type: "number" as const,
    description: `${zweck} (default ${grenzen.vorgabe}, max ${grenzen.max})${nachsatz}`,
    default: grenzen.vorgabe,
  };
}

// bible_setup ist das eine Werkzeug, das schreibt: Es lädt die Bibeldaten und
// ersetzt die Datenbankdatei. readOnlyHint und openWorldHint sind für es deshalb
// beide falsch, und destructiveHint wird bedeutsam. Es ergänzt ausschließlich
// Daten, und ein erneuter Lauf baut dieselben Tabellen wieder auf; es ist also
// weder zerstörend noch schädlich zu wiederholen.
const SETUP_ANNOTATIONS = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const handleListTools = async () => ({
  tools: [
    // Nur angeboten, solange die Daten fehlen, und niemals über HTTP: Steht die
    // Datenbank erst, hat dieses Werkzeug nichts anzubieten, und eine sichtbare
    // Aktion „Datenbank aufbauen" lädt ein Modell dazu ein, bereits geglückte
    // Downloads erneut anzustoßen. An einem HTTP-Endpunkt darf es gar nicht
    // erscheinen, siehe HTTP_MODE.
    //
    // Das eine Werkzeug ohne outputSchema, und das ist entschieden, nicht
    // vergessen: Es antwortet in zwei verschiedenen Gestalten (dem Plan und dem
    // Ergebnis eines Laufs), es ist das einzige schreibende Werkzeug, und kein
    // Konsument braucht seine Ausgabe als Daten. Ein Schema zu deklarieren
    // brächte nichts ein und schüfe eine zweite Gestalt, die mitzupflegen wäre.
    // Deshalb liefert es sein Ergebnis auch weiterhin unmittelbar statt über
    // jsonResult().
    ...(dataMissing !== null && !HTTP_MODE
      ? [
          {
            name: "bible_setup",
            annotations: SETUP_ANNOTATIONS,
            description:
              "Download the Bible data this server needs. The database is not shipped with " +
              "the server and has to be built once from the original sources; it takes about " +
              "a minute and needs an internet connection. " +
              "Call this only after the user has explicitly agreed to start the download: " +
              "ask first, then pass bestaetigung=true. Without that flag the tool only " +
              "reports what would be downloaded.",
            inputSchema: {
              type: "object" as const,
              properties: {
                bestaetigung: {
                  type: "boolean" as const,
                  description:
                    "Set to true only when the user has agreed to start the download now. " +
                    "Omit it to get the plan without downloading anything.",
                },
              },
            },
          },
        ]
      : []),
    {
      name: "bible_lookup",
      annotations: READ_ONLY_LOCAL,
      // Die Rahmung über „Zitate" allein wurde so gelesen, als deckte sie nur
      // Fragen nach dem Wortlaut: „Schlag mir Hesekiel-Zusatz 1,1 nach" wurde aus
      // dem Gedächtnis beantwortet, weil das Buch nicht zu existieren schien und
      // deshalb kein Zitat erwartet wurde (25.07.2026). Fragen nach Existenz und
      // Kanon sind genau die, die der Server klären kann; das gehört gesagt.
      description:
        "Look up Bible verses by reference. Returns exact text from a licensed German " +
        "translation (see the `translation` argument for this instance's default). Use this " +
        "for ALL Bible quotes — never quote " +
        "from memory. " +
        "When the edition carries footnotes for the requested verses, the field 'fussnoten' " +
        "holds them verbatim: these are the publisher's own notes, not this server's, and " +
        "they typically record an alternative rendering the edition weighed. " +
        "Also call it when a book or reference looks unfamiliar, misspelled or made up, " +
        "and before answering whether a book exists or belongs to the canon: the error " +
        "names the nearest known book and states which canon this database covers. " +
        "Do not answer such questions from memory either — a reference that seems wrong " +
        "is a reason to call this tool, not to skip it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description:
              'Book name in German (e.g. "Jesaja", "1. Mose", "Römer", "Ps", "Mt")',
          },
          chapter: {
            type: "number",
            description: "Chapter number",
          },
          verses: {
            type: "string",
            description:
              'Verse(s): single "4", range "16-17", list "1,3,5", or combined "1-3,7". Omit for the ' +
              "whole chapter. Some editions cap how many verses one call may quote; the response " +
              "then says so in `hinweis` and `gekuerzt`, and `reference` names what it contains.",
          },
          translation: translationArg("Translation:"),
        },
        required: ["book", "chapter"],
      },
      outputSchema: LOOKUP_OUTPUT,
    },
    {
      name: "bible_original",
      annotations: READ_ONLY_LOCAL,
      description:
        "Return one Bible verse word-by-word in the ORIGINAL language with lemma, Strong's " +
        "number and full morphology. Use this to verify what the original text says — e.g. " +
        "whether a noun is singular or plural — instead of inferring it from a translation. " +
        "Covers the whole Bible: the OT (book 1–39) is served from the Hebrew/Aramaic " +
        "Westminster Leningrad Codex; the NT (40–66) from a Greek text type chosen via " +
        '`texttyp` — "byzantine" (Majority Text, default), "sblgnt" (critical), or "tr" ' +
        "(Textus Receptus, the only one with the Comma Johanneum). Edition and text type are " +
        "labelled in the output.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description: 'Book name in German (e.g. "1. Mose", "Jesaja", "Römer", "Galater")',
          },
          chapter: { type: "number", description: "Chapter number" },
          verse: { type: "number", description: "Single verse number" },
          texttyp: {
            type: "string",
            description:
              'NT text edition: "byzantine" (Majority Text, default), "sblgnt" (critical SBL), ' +
              'or "tr" (Textus Receptus). Ignored for the OT (always Hebrew WLC). Compare ' +
              "byzantine vs. tr to see TR-only readings such as the Comma Johanneum (1Joh 5,7).",
            default: "byzantine",
          },
        },
        required: ["book", "chapter", "verse"],
      },
      outputSchema: ORIGINAL_OUTPUT,
    },
    {
      name: "bible_crossrefs",
      annotations: READ_ONLY_LOCAL,
      description:
        "Find cross-references (related/parallel passages) for one Bible verse, ranked by " +
        "relevance votes, with the German text of the targets (in editions " +
        "that cap verbatim quoting, the later targets carry `stelle` and `votes` only). Use this " +
        "to find where a theme, quote or promise recurs elsewhere in Scripture. Where the UBS " +
        "Parallel Passage Database lists the verse, `parallelen` adds the closed set of parallel " +
        "places (synoptic pericopes, Kings/Chronicles doublets, OT quotations in the NT, " +
        "recurring formulas) that the vote ranking often buries. Data: Treasury of Scripture " +
        "Knowledge (expanded), OpenBible.info, CC-BY; UBS Parallel Passage Database, CC BY-SA 4.0.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description: 'Book name in German (e.g. "Jesaja", "1. Mose", "Römer")',
          },
          chapter: { type: "number", description: "Chapter number" },
          verse: { type: "number", description: "Single verse number" },
          limit: limitArg("Maximum number of references to return", XREF_LIMIT),
          translation: translationArg("Translation for the quoted target texts:"),
        },
        required: ["book", "chapter", "verse"],
      },
      outputSchema: CROSSREFS_OUTPUT,
    },
    {
      name: "bible_concordance",
      annotations: READ_ONLY_LOCAL,
      description:
        "Concordance / word study: find ALL occurrences of an original-language word across " +
        'the Bible. Search by Strong\'s number (preferred; "G26" = Greek/NT, "H7225" = ' +
        "Hebrew/OT) or by exact lemma as returned by bible_original (e.g. \"ἀγάπη\", " +
        '"רֵאשִׁית"). Returns total count, per-book distribution, an occurrence list with ' +
        "the inflected surface forms, and English lexicon data (gloss, Strong's definition; " +
        "for Greek also the full Abbott-Smith entry). NT edition selectable via texttyp " +
        "(default byzantine).",
      inputSchema: {
        type: "object" as const,
        properties: {
          strong: {
            type: "string",
            description: 'Strong\'s number with testament prefix, e.g. "G26" or "H7225"',
          },
          lemma: {
            type: "string",
            description:
              "Exact Greek or Hebrew lemma (alternative to strong; script determines testament)",
          },
          texttyp: {
            type: "string",
            description:
              'NT text edition: "byzantine" (default), "sblgnt", or "tr". Ignored for Hebrew.',
            default: "byzantine",
          },
          limit: limitArg("Maximum occurrences to list", CONCORDANCE_LIMIT, "; counts are always exact"),
        },
        required: [],
      },
      outputSchema: CONCORDANCE_OUTPUT,
    },
    {
      name: "bible_search",
      annotations: READ_ONLY_LOCAL,
      description:
        "Full-text search over the German Bible text. Finds verses " +
        "containing ALL given words (exact word forms; umlauts/accents are folded, so 'fuhrt' " +
        'matches "führt"). Quote phrases ("Gnade um Gnade"); a trailing * makes a prefix ' +
        "search (lieb* finds liebe/lieben/liebet …). Use this to locate a passage when the " +
        "wording is known but the reference is not. Optionally restrict to one book.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: 'Words or "phrases" to search for, e.g. \'Hirte mangeln\' or \'"Gnade um Gnade"\'',
          },
          book: {
            type: "string",
            description: 'Optional: restrict to one book (German name, e.g. "Psalmen", "Röm")',
          },
          limit: limitArg("Maximum verses to return", SEARCH_LIMIT, "; the total count is always exact"),
          translation: translationArg("Translation to search:"),
        },
        required: ["query"],
      },
      outputSchema: SEARCH_OUTPUT,
    },
    {
      name: "bible_compare",
      annotations: READ_ONLY_LOCAL,
      description:
        "Compare one NT verse word-by-word across the Greek editions (byzantine Majority Text, " +
        "tr Textus Receptus, sblgnt critical text) and list the textual differences. " +
        "Accentuation/case are ignored (byzantine/tr are stored unaccented), so reported " +
        "differences are real variants or spelling variants (e.g. movable Ny). Additionally " +
        "reports per-word attestation across eight editions (NA27/28, Tyndale House, SBL, " +
        "Westcott-Hort, Tregelles, TR, Byzantine; STEPBible TAGNT). Use for questions about " +
        "textual variants (e.g. the Comma Johanneum, 1Jn 5:7). OT verses have only one " +
        "edition (WLC) and cannot be compared.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description: 'NT book name in German (e.g. "Römer", "1Joh")',
          },
          chapter: { type: "number", description: "Chapter number" },
          verse: { type: "number", description: "Single verse number" },
        },
        required: ["book", "chapter", "verse"],
      },
      outputSchema: COMPARE_OUTPUT,
    },
    // Bewusst über den Server, nicht über die Schrift: Die Version erreicht die
    // Clients im initialize-Handschlag, aber kein Client zeigt sie dem Nutzer, und
    // das Modell erreicht sie ebenso wenig (gemessen 26.07.2026: instructions ist
    // gesetzt und blieb im Chat trotzdem unsichtbar). Ein Werkzeugergebnis ist der
    // eine Kanal, den das Modell sicher sieht, und „auf welcher Version laufen
    // Sie?" ist die erste Frage, die ein Fehlerbericht beantworten muss.
    //
    // Meldet allein, was sich zwischen Installationen unterscheidet: die Version
    // und den Datenbestand dieser Instanz. data/ entsteht lokal und wird nicht
    // ausgeliefert, zwei Server derselben Version können also verschiedene Texte
    // führen. Keine Host-Details (Laufzeit, Pfade, Prozess, Maschine): Dieser
    // Endpunkt ist öffentlich und authlos, und einen Fremden gehen sie nichts an.
    {
      name: "bible_server_info",
      annotations: READ_ONLY_LOCAL,
      description:
        "Report this server's own release version and which Bible data it has loaded, " +
        "including each edition's licence, required attribution and how many verses it " +
        "may quote verbatim per call. Use when asked which version runs, when collecting " +
        "facts for a bug report, and before planning a longer quotation. " +
        "Returns no scripture — use bible_lookup for verse text.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      outputSchema: SERVER_INFO_OUTPUT,
    },
  ],
});

// --- MCP-Server: geführte Prompts ------------------------------------------
// Ablauf-Prompts, die die Lesewerkzeuge zusammenspielen lassen. Bezeichner und
// Beschreibungen sind englisch (wie die Werkzeugnamen); die Prompt-Texte selbst
// sind deutsche Inhalte für den Nutzer, passend zu den deutschen Ausgabefeldern.

// `title` ist der Anzeigename, den ein Client in seinem Prompt-Menü zeigt, und
// dieses Menü liest der Nutzer, nicht das Modell; aus demselben Grund tragen die
// Ressourcen deutsche Namen. `name` bleibt englisch und unverändert: Es ist der
// Bezeichner, den ein Aufrufer schickt, und ihn umzubenennen wäre eine brechende
// Änderung. Prompt-Argumente haben im SDK-Schema kein `title` (nur name,
// description, required), ihr Wortlaut bleibt deshalb in `description`.
const PROMPTS = [
  {
    name: "word-study",
    title: "Wortstudie",
    description:
      "Guided original-language word study: from a German word, lemma or Strong's number " +
      "to meaning spectrum, distribution and key passages.",
    arguments: [
      {
        name: "word",
        description: "German word, Greek/Hebrew lemma, or Strong's number (e.g. G26)",
        required: true,
      },
      {
        name: "reference",
        description: 'Optional Bible reference as starting point (e.g. "Johannes 3,16")',
        required: false,
      },
    ],
  },
  {
    name: "variant-check",
    title: "Textvarianten prüfen",
    description:
      "Guided text-critical check of one NT verse: edition diff, eight-edition attestation, " +
      "sober assessment.",
    arguments: [
      {
        name: "reference",
        description: 'NT verse reference (e.g. "1. Johannes 5,7")',
        required: true,
      },
    ],
  },
  {
    name: "translation-compare",
    title: "Übersetzungen vergleichen",
    description:
      "Compare one passage across all loaded German translations and check notable " +
      "renderings against the original text.",
    arguments: [
      {
        name: "reference",
        description: 'Bible reference (e.g. "Psalm 23,1" or "Römer 8,1")',
        required: true,
      },
    ],
  },
] as const;

const handleListPrompts = async () => ({
  prompts: PROMPTS.map((p) => ({ ...p, arguments: [...p.arguments] })),
});

// Ein Prompt-Argument wird in eine nummerierte Anweisung eingesetzt und
// bekommt deshalb dieselbe Behandlung wie ein Werkzeugargument: Fehlt ein
// erforderliches, muss das dastehen, statt eine Anweisung mit einem Loch darin
// zu erzeugen (`Wortstudie zu „"`), und Zeilenumbrüche oder Steuerzeichen
// zerrissen die Liste, in der der Wert landet. 100 Zeichen fassen jeden gültigen
// Wert mit reichlich Luft: Die längste Stellenangabe hat rund 20 („1.
// Thessalonicher 5,23"), eine Strong-Nummer fünf.
const MAX_PROMPT_ARG_LENGTH = 100;

/**
 * Liest ein Prompt-Argument: faltet Leerraum und Steuerzeichen, setzt die
 * Längengrenze durch und weist einen fehlenden Pflichtwert ab. Wirft, denn ein
 * Prompt-Ergebnis hat keinen `isError`-Kanal: Der Fehler gehört in die
 * JSON-RPC-Antwort.
 *
 * `InvalidParams` ist hier ausdrücklich das, was die Spezifikation verlangt:
 * "Missing required arguments: -32602", "Invalid prompt name: -32602"
 * (server/prompts, ein SHOULD in jeder Revision, die dieser Server spricht).
 */
function promptArg(args: Record<string, unknown>, name: string, required: boolean): string {
  const raw = args[name];
  const value =
    typeof raw === "string" ? raw.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim() : "";
  if (value === "") {
    if (required) throw rpcError(ErrorCode.InvalidParams, `Missing required argument '${name}'`);
    return "";
  }
  if (value.length > MAX_PROMPT_ARG_LENGTH) {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Argument '${name}' must be at most ${MAX_PROMPT_ARG_LENGTH} characters`
    );
  }
  return value;
}

/** "\"LUT\" (Luther 1912), \"SCH\" (…)": Die Kürzel allein bezeichnen nichts. */
function loadedTranslationList(): string {
  return [...availableTranslations]
    .sort()
    .map((code) => `"${code}" (${TRANSLATIONS[code as TranslationCode]?.name ?? code})`)
    .join(", ");
}

const handleGetPrompt = async (request: GetPromptRequest) => {
  const name = request.params.name;
  // Auf `unknown`-Werte gecastet, nicht auf `string` (docs/TYPESCRIPT.md, Regel 4):
  // Der Typ behauptete sonst, die Laufzeitprüfung in `promptArg` sei überflüssig.
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  // Vor der Auswertung, also gezählt werden Versuche und nicht geglückte
  // Abrufe: Ein fehlendes Pflichtargument wirft weiter unten, und gerade das
  // ist eine Beobachtung, die interessiert. Ein unbekannter Name fällt in
  // `zaehlePrompt` auf ein festes Label, sonst legte ein anonymer Aufrufer mit
  // erfundenen Namen beliebig viele Zeitreihen an.
  zaehlePrompt(name);

  let text: string;
  if (name === "word-study") {
    const word = promptArg(args, "word", true);
    const ref = promptArg(args, "reference", false);
    // Jeder Schritt nennt die Felder, die die Antwort tatsächlich trägt, und
    // nicht die Begriffe dahinter: Hier stand einmal „Gloss, Definition,
    // Abbott-Smith", während die Antwort von `kurzbedeutung`, `bedeutung` und
    // `lexikon` spricht. Aus demselben Grund bekamen die nackten
    // Editionsschlüssel in `bible_server_info` ihre Namen: Einen Begriff, den die
    // Nutzlast nie verwendet, kann ein Konsument nicht auflösen.
    const lexikon = !hasStrongDefs
      ? " Lexikondaten sind in dieser Datenbank nicht geladen; das Bedeutungsspektrum ergibt sich dann allein aus den Belegstellen."
      : hasStepCols
        ? " Die Lexikondaten stehen in 'kurzbedeutung', 'bedeutung', 'umschrift', 'kjv_woerter' und, nur bei Griechisch, im vollständigen Abbott-Smith-Artikel unter 'lexikon'."
        : " Die Lexikondaten stehen in 'bedeutung', 'umschrift' und 'kjv_woerter'; 'kurzbedeutung' und 'lexikon' fehlen in dieser Datenbank.";
    const startpunkt = ref
      ? `Rufe bible_original für ${ref} ab und identifiziere dort das Wort (Grundform + Strong-Nummer).`
      : `Ist „${word}" bereits eine Strong-Nummer oder ein griechisches/hebräisches Lemma, nutze es direkt. Ist es ein deutsches Wort, ${hasFts ? "finde über bible_search eine typische Belegstelle und rufe für sie bible_original ab" : "erfrage eine Belegstelle beim Nutzer und rufe für sie bible_original ab: die Volltextsuche ist in dieser Datenbank nicht geladen"}.`;
    text =
      `Führe eine Wortstudie zu „${word}" durch. Arbeite ausschließlich mit den Bibelstudium-Tools: zitiere keinen Bibeltext aus dem Gedächtnis.\n\n` +
      `1. Bestimme das Urtext-Wort: ${startpunkt}\n` +
      `2. Rufe bible_concordance mit der Strong-Nummer ab. Die Zahlen stehen in der Antwort und werden übernommen, nicht nachgezählt: 'gesamt' sind die Vorkommen, 'verse' die Verse, 'buecher' die vollständige Verteilung, auch wenn die Liste 'vorkommen' gekürzt ist (dann sagt es 'hinweis'). Alle Zahlen gelten je Edition.${lexikon}\n` +
      `3. Wähle 2 bis 3 Vorkommen aus, und zwar nach der Verteilung in 'buecher' (verschiedene Bücher, auffällige Häufungen), nicht nach Bekanntheit. Rufe für sie bible_lookup ab${hasXrefs || hasParallels ? " und bible_crossrefs für die Parallelstellen" : ""}.\n` +
      `4. Fasse das Bedeutungsspektrum zusammen: Grundbedeutung, Bedeutungsnuancen nach Kontext, auffällige Verteilung. Belege jede Aussage mit einer konkret abgerufenen Stelle; kennzeichne offene Fragen als offen.`;
  } else if (name === "variant-check") {
    const ref = promptArg(args, "reference", true);
    // Aus dem Geladenen abgeleitet, nicht aus einem festen Dreiergespann: Einer
    // Instanz mit nur zwei NT-Editionen würde sonst aufgetragen, eine dritte
    // aufzurufen.
    const geladen = NT_EDITION_ORDER.filter((e) => availableEditions.has(e));
    const editionen =
      geladen.map((e) => `texttyp "${e}" (${EDITION_META[e]!.label})`).join(", ") ||
      "keine NT-Edition (in dieser Datenbank ist keine geladen, der Vergleich ist hier nicht möglich)";
    // Der Bezeugungsblock ist optional: Ihn ohne Vorbehalt zu nennen
    // schickte das Modell auf die Suche nach einem Feld, das eine Instanz ohne
    // TAGNT nie liefert. Seine Vorbehaltsfelder werden ausdrücklich benannt, denn
    // sie sind gemessen die, die übergangen werden, wenn sie tief in der Antwort
    // liegen.
    const bezeugung = hasTagnt
      ? ` Dazu kommt in 'bezeugung' die Bezeugung pro Wort über acht Editionen.\n` +
        `2. Lies 'warnung' und 'quellenkonflikte' zuerst, falls sie dastehen: Dort widerspricht die TAGNT-Notiz dem Editionstext, und maßgeblich ist der Editionstext. In 'bezeugung.abweichend' gilt dasselbe je Wort: 'in_dieser_db' sagt, welche der geladenen Editionen eine Form tatsächlich liest, während die Notizen 'bedeutungsvariante'/'schreibvariante' nur die Zeugen des STEPBible-Apparats nennen. Aus einer Notiz folgt nicht, dass die übrigen Editionen anders lesen.\n`
      : ` Die Editionsbezeugung (TAGNT) ist in dieser Datenbank nicht geladen; die Antwort trägt dann kein Feld 'bezeugung'.\n`;
    text =
      `Prüfe die Textüberlieferung von ${ref}. Der Editionsvergleich gilt nur fürs Neue Testament. Arbeite ausschließlich mit den Bibelstudium-Tools: keine Behauptungen ohne Tool-Beleg.\n\n` +
      `1. Rufe bible_compare für ${ref} ab: Wort-Diff über die geladenen Editionen, hier ${editionen}.${bezeugung}` +
      `${hasTagnt ? 3 : 2}. Bei relevanten Unterschieden: Rufe bible_original für ${ref} mit jedem betroffenen texttyp ab, um die Lesarten im Wortlaut zu sehen. Das Feld 'wort' ist quellentreu (byzantine und tr sind unakzentuiert gespeichert, sblgnt akzentuiert): so zitieren, wie es dasteht, keine Akzente ergänzen.\n` +
      `${hasTagnt ? 4 : 3}. Rufe bible_lookup für ${ref} ab und prüfe, welcher Lesart der deutsche Text folgt.\n` +
      `${hasTagnt ? 5 : 4}. Ordne nüchtern ein: Welche Editionen bezeugen welche Lesart? Im Feld 'typ' steht N für Nestle-Aland, K für die KJV/TR-Tradition, O für andere; ein Kleinbuchstabe heißt „ohne Übersetzungsrelevanz". Ändert die Variante die Aussage des Verses? Keine Wertung über „besser/schlechter" ohne Datengrundlage: benenne nur, was die Editionen tatsächlich lesen.`;
  } else if (name === "translation-compare") {
    const ref = promptArg(args, "reference", true);
    const liste = loadedTranslationList();
    // Menge und Schlachter 2000 setzen erklärende Einschübe in eckige Klammern
    // (137 bzw. 1925 Verse, gemessen 05.08.2026), die übrigen nicht. Vorab
    // benannt statt auf den Hinweis in der Antwort verlassen: Der ganze Sinn
    // dieses Prompts ist der Vergleich Wort für Wort, und genau dort liest sich
    // ein aus den Klammern genommener Einschub wie der Wortlaut der Ausgabe
    // selbst. Die Bedingung fragt beide Ausgaben ab; hinge sie weiter allein an
    // Menge, fiele der Satz in einer Datenbank mit Schlachter 2000 und ohne
    // Menge weg, obwohl es dort 1925 Klammerverse gibt.
    const mitKlammern = ["MB", "SLT"].some((c) => availableTranslations.has(c));
    const klammern = mitKlammern
      ? " Wörter in eckigen Klammern gehören zum Wortlaut der Ausgabe und bleiben beim Zitieren stehen; sie sind keine Einfügung dieses Servers."
      : "";
    // Der Anmerkungsapparat ist der zweite Ort, an dem eine Ausgabe selbst über
    // ihre Wiedergabe spricht, und er ist für diesen Prompt einschlägiger als
    // jedes andere Feld: Er nennt die Alternative, die der Vergleich sucht.
    const apparat = hasVerseNotes
      ? " Trägt eine Antwort das Feld 'fussnoten', gehört es in den Vergleich: Dort sagt die Ausgabe selbst, welche andere Wiedergabe sie erwogen hat."
      : "";
    // Dieser Prompt lässt dieselbe Stelle in jeder Ausgabe abrufen und nach
    // ausgelassenen Wörtern fragen. Bei einem ganzen Kapitel liefern die
    // Ausgaben mit Wortlaut-Grenze weniger Verse als die übrigen, und der
    // nächstliegende Fehlschluss ist genau der falsche: „diese Ausgabe lässt
    // die Verse 21 bis 176 aus." Der `hinweis` der Antwort sagt das Gegenteil,
    // aber er sagt es erst hinterher; hier steht es vorher. Die Bedingung fragt
    // den geladenen Bestand ab, damit der Satz in einer Datenbank ohne begrenzte
    // Ausgabe wegfällt, statt vor etwas zu warnen, das dort nicht vorkommt.
    const mitGrenze = loadedTranslationCodes().some((c) => TRANSLATIONS[c].verseMax !== null);
    const grenze = mitGrenze
      ? " Trägt eine Antwort das Feld 'gekuerzt', gibt diese Ausgabe je Abruf nur eine begrenzte Zahl Verse im Wortlaut aus: Vergleiche dann allein die Verse, die alle Antworten enthalten. Fehlende Verse sind eine Grenze dieses Servers und keine Auslassung der Ausgabe."
      : "";
    text =
      `Vergleiche die deutschen Übersetzungen von ${ref}. Arbeite ausschließlich mit den Bibelstudium-Tools.\n\n` +
      `1. Rufe bible_lookup für ${ref} mit jeder geladenen Übersetzung ab: ${liste || "keine (in dieser Datenbank ist keine Übersetzung geladen)"}.\n` +
      `2. Stelle die Wortlaute gegenüber und benenne die Unterschiede (Wortwahl, Satzbau, ausgelassene/ergänzte Wörter).${grenze}${klammern}${apparat}\n` +
      `3. Prüfe auffällige Unterschiede am Urtext: Rufe bible_original für ${ref} ab (AT: hebräischer WLC; NT: nach texttyp) und kläre, welche Wiedergabe dem Grundtext am nächsten kommt. Bei NT-Versen zusätzlich bible_compare, denn die Übersetzungen können verschiedenen Editionen folgen.\n` +
      `4. Fazit: Wo sind die Unterschiede nur stilistisch, wo inhaltlich? Belege am abgerufenen Text, nicht aus dem Gedächtnis.`;
  } else {
    throw rpcError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
  }

  const meta = PROMPTS.find((p) => p.name === name)!;
  return {
    description: meta.description,
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
};

// --- MCP-Server: Ressourcen ------------------------------------------------
// Das dritte Primitiv, und das einzige, nach dem der *Nutzer* greift: Werkzeug
// und Prompt wählt das Modell, eine Ressource hängt man von Hand an. Deshalb sind
// die Namen, Beschreibungen und URI-Wörter hier deutsch, während die Bezeichner
// von Werkzeugen und Prompts englisch sind: Das Publikum ist ein anderes.
//
// Der Katalog bleibt mit Absicht klein. `resources/list` geht bei jedem
// Sitzungsbeginn über die Leitung, und diese Datenbank führt 31 102 Verse in
// 1190 Kapiteln: Irgendeinen Teil davon aufzuzählen ließe `tools/list` winzig
// aussehen (14 969 Zeichen, gemessen 02.08.2026). Der parametrisierte Raum liegt
// in URI-Vorlagen, die Liste trägt vier feste Einträge, die den Bestand selbst
// beschreiben.

const URI_SCHEME = "bible://";

// Abgeleitet aus den Grenzen, die die Segmente ohnehin tragen, nicht gewählt:
// das Schema, vier namensartige Segmente (jedes durch MAX_BOOK_LENGTH begrenzt,
// die weiteste solche Grenze im Gebrauch), eine Versliste von
// MAX_VERSES_LENGTH, die Trennzeichen, und ein Faktor drei für die
// Prozentkodierung: drei Zeichen je Byte, und Buchnamen sind überwiegend ASCII
// (der längste hat rund 20 Zeichen, die Grenze 50; ein Name aus lauter
// Umlauten käme auf neun Zeichen je Buchstabe und stieße nicht an). Wie
// MAX_VERSES_LENGTH kann auch diese Grenze
// nie die einzige verletzte sein; sie steht da, um eine übergroße URI vor dem
// ersten split abzuweisen, und nicht als eigene Regel.
const MAX_URI_LENGTH =
  URI_SCHEME.length + 4 + (4 * MAX_BOOK_LENGTH + MAX_VERSES_LENGTH) * 3;

const RESOURCES = [
  {
    uri: "bible://buecher",
    name: "Bücher",
    description:
      "Die 66 Bücher mit Nummer, Name, Kapitelzahl und Testament. Die Namen und " +
      "ihre Abkürzungen sind es, die in den URI-Vorlagen als {buch} stehen.",
    mimeType: "application/json",
  },
  {
    uri: "bible://uebersetzungen",
    name: "Übersetzungen",
    description:
      "Die geladenen deutschen Übersetzungen mit Kürzel, Name, Lizenz und " +
      "geforderter Namensnennung, dazu die Voreinstellung.",
    mimeType: "application/json",
  },
  {
    uri: "bible://editionen",
    name: "Grundtext-Editionen",
    description:
      "Die geladenen Editionen des Grundtextes mit Sprache, Eigenheiten der " +
      "Schreibung, Lizenz und Namensnennung, dazu die Zuordnung nach Testament.",
    mimeType: "application/json",
  },
  {
    uri: "bible://quellen",
    name: "Quellen und Lizenzen",
    description:
      "Alle Quellen, aus denen diese Instanz tatsächlich Daten führt, mit Lizenz " +
      "und der Nennung, die beim Weitergeben verlangt ist.",
    mimeType: "application/json",
  },
] as const;

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "bible://kapitel/{uebersetzung}/{buch}/{kapitel}",
    name: "Kapitel",
    description:
      "Ein ganzes Kapitel in einer Übersetzung, Vers für Vers. {uebersetzung} " +
      'nimmt Kürzel oder Namen ("LUT", "Schlachter"), {buch} den deutschen ' +
      'Buchnamen oder eine Abkürzung ("Johannes", "1. Mose", "Röm").',
    mimeType: "application/json",
  },
  {
    uriTemplate: "bible://vers/{uebersetzung}/{buch}/{kapitel}/{verse}",
    name: "Vers oder Versbereich",
    description:
      'Einzelne Verse einer Übersetzung. {verse} nimmt "16", einen Bereich ' +
      '"16-17" oder eine Liste "1-3,7".',
    mimeType: "application/json",
  },
  {
    uriTemplate: "bible://grundtext/{edition}/{buch}/{kapitel}/{vers}",
    name: "Grundtext eines Verses",
    description:
      "Ein Vers Wort für Wort mit Grundform, Strong-Nummer und aufgelöster " +
      'Morphologie. {edition} nimmt "byzantine", "sblgnt", "tr" (Neues ' +
      'Testament) oder "wlc" (Altes Testament).',
    mimeType: "application/json",
  },
] as const;

/**
 * Warum die Listen ohne Daten leer sind, und warum das Lesen wirft.
 *
 * Ein Ressourcenergebnis hat keinen `isError`-Kanal, eine Abweisung gehört also
 * in die JSON-RPC-Antwort, genau wie bei den Prompts. Und der Wortlaut trennt
 * sich nach Transport, aus demselben Grund wie bei der Werkzeugsperre: Über
 * stdio hat der Aufrufer diesen Prozess gestartet und kann bible_setup
 * ausführen, über HTTP ist er ein Fremder, dem dieses Werkzeug zu nennen etwas
 * beschriebe, das es dort nicht gibt.
 *
 * Der eine Wurf in dieser Datei, der `InternalError` behält, und das nicht aus
 * Versehen: Eine Instanz ohne Datenbank ist ein Zustand des Servers und kein
 * Fehler der Anfrage. Jede andere Abweisung weiter unten ist die des Aufrufers
 * und sagt `InvalidParams`. Diese hier nicht mit ihnen umstellen.
 */
function requireData(): void {
  if (dataMissing === null) return;
  throw rpcError(
    ErrorCode.InternalError,
    HTTP_MODE
      ? `${dataMissing} Dieser Endpunkt hat derzeit keine Bibeldaten. Das lässt sich ` +
          "nur serverseitig beheben; ein erneuter Abruf hilft nicht."
      : `${dataMissing} Dieser Server bringt die Bibeldaten nicht mit. Über das ` +
          "Werkzeug bible_setup lassen sie sich einmalig laden; danach ist die " +
          "Ressource abrufbar."
  );
}

const handleListResources = async () => ({
  resources: dataMissing !== null ? [] : RESOURCES.map((r) => ({ ...r })),
});

const handleListResourceTemplates = async () => ({
  resourceTemplates: dataMissing !== null ? [] : RESOURCE_TEMPLATES.map((t) => ({ ...t })),
});

// --- Ressourcen: URI-Segmente ----------------------------------------------
// Jede Segmentprüfung greift auf die Grenze und die Meldung zurück, die die
// Werkzeuge ohnehin verwenden. Sechs jener Meldungen nannten einmal eine
// Bedingung, die die Eingabe erfüllte, weil die Grenze neben einem getrennt
// formulierten Text stand (25.07.2026); ein Ressourcenpfad mit eigenem Wortlaut
// wiederholte das, deshalb gibt es hier keinen.
//
// Jede Abweisung in diesem Abschnitt wirft `InvalidParams`, und das braucht ein
// Wort, denn die Protokollrevision, die dieser Server spricht, sagt etwas
// anderes. Für Ressourcen führt sie "Resource not found: -32002, Internal
// errors: -32603" (server/resources, ein SHOULD). Gewählt ist trotzdem -32602:
// -32002 passt auf die zwei Nicht-gefunden-Fälle und auf keinen der dreizehn
// Fälle einer fehlerhaften URI; die Entwurfsrevision schafft den Code ganz ab
// ("-32002 … replaced by -32602", und Umsetzungen jener Fassung dürfen ihn nicht
// senden, MUST NOT); und das SDK, auf dem dieser Server läuft, beantwortet eine fehlende
// Ressource bereits mit -32602 (server/mcp.js:393). Unter jeder dieser Lesarten
// ist -32603 falsch, und das ist es, was diese Umstellung geändert hat. Keiner
// der beiden Codes rührt an den reservierten Bereich -32020 bis -32099; die
// Entscheidung vom 28.07.2026, als Server vor der Revision 2026-07-28 erkennbar
// zu bleiben, ist also unberührt.
//
// Der gemessene Preis, und er fällt hier an und sonst nirgends: Claude Code
// liest -32602 bei `resources/read` als „nicht gefunden" und ersetzt die Meldung
// unten durch eine eigene ("Resource not found: … Re-run ListMcpResourcesTool to
// refresh"). Unter -32603 reichte der Client den Wortlaut des Servers wörtlich
// durch. Gemessen am 02.08.2026 gegen den ausgerollten Endpunkt davor und
// danach, an zwei Arten fehlerhafter URI, bei durchgängig zeichengleichen
// Texten; Prompts und Werkzeuge sind nicht betroffen. Jede Meldung dieses
// Abschnitts ist also weiterhin genau, und in diesem einen Client liest sie
// niemand. Ob -32002 besser abschnitte, ist ungeprüft und kostet zum Herausfinden
// einen Rollout. Siehe docs/ENTSCHEIDUNGEN.md und docs/FEHLERBEHEBUNG.md.

/**
 * Prüft die Anzahl der Segmente, weist leere zurück und gibt eine Kopie heraus.
 *
 * Die Leerprüfung ist nicht kosmetisch: `resolveTranslation("")` antwortet mit
 * der Voreinstellung, "bible://kapitel/…//23" lieferte also stillschweigend
 * Luther für eine Übersetzung, die der Aufrufer nie genannt hat. Aufrufer greifen
 * mit `!` auf das Ergebnis zu, und diese Längenprüfung ist es, die das
 * rechtfertigt.
 *
 * Kein "Error:"-Präfix an den hier formulierten Meldungen: Die Hausregel lautet,
 * dass eine Meldung mit der Aussage beginnt, und ein Client des 1.x-SDK stellt
 * einem JSON-RPC-Fehler ohnehin "MCP error <code>: " voran (types.js:2031), das
 * Wort erschiene also zweimal. Die von den Werkzeugen geerbten Meldungen behalten
 * ihr Präfix: Dort wiegt die Zeichengleichheit mit dem Werkzeug schwerer als der
 * Hausstil.
 */
function requireSegments(rest: readonly string[], count: number, form: string): string[] {
  if (rest.length !== count || rest.some((s) => s === "")) {
    throw rpcError(ErrorCode.InvalidParams, `Falsche Form der URI. Erwartet: "${form}".`);
  }
  return [...rest];
}

/**
 * Länge und Auflösung sind getrennt, weil die Werkzeuge sie an verschiedenen
 * Stellen prüfen: `bible_lookup` begrenzt den Buchnamen zuerst, löst ihn aber
 * erst nach Kapitel und Versen auf. Eine URI, die zwei Bedingungen verletzt, muss
 * deshalb dieselbe melden wie das Werkzeug. Zusammengelegt nannte die Ressource
 * das Buch, während das Werkzeug das Kapitel nannte.
 */
function requireBookLength(segment: string): void {
  if (segment.length > MAX_BOOK_LENGTH) throw rpcError(ErrorCode.InvalidParams, bookTooLong);
}

function segmentBookId(segment: string): number {
  const bookId = resolveBook(segment);
  if (bookId === null) throw rpcError(ErrorCode.InvalidParams, bookNotFoundMessage(segment));
  return bookId;
}

function segmentChapter(segment: string): number {
  const chapter = toInt(segment);
  if (chapter === null || chapter < 1 || chapter > MAX_CHAPTER) {
    throw rpcError(ErrorCode.InvalidParams, chapterOutOfRange);
  }
  return chapter;
}

function segmentVerse(segment: string): number {
  const verse = toInt(segment);
  if (verse === null || verse < 1 || verse > MAX_VERSE) {
    throw rpcError(ErrorCode.InvalidParams, verseOutOfRange);
  }
  return verse;
}

/** Dieselben vier Prüfungen, dieselbe Reihenfolge, dieselben Meldungen wie in `bible_lookup`. */
function segmentVerses(segment: string): string {
  if (segment.length > MAX_VERSES_LENGTH) {
    throw rpcError(ErrorCode.InvalidParams, versesTooLong);
  }
  if (segment.split(",").length > MAX_VERSE_PARTS) {
    throw rpcError(ErrorCode.InvalidParams, versesTooManyParts);
  }
  const ausserhalb = [...segment.matchAll(/\d+/g)].some(([n]) => {
    const value = parseInt(n, 10);
    return value < 1 || value > MAX_VERSE;
  });
  if (ausserhalb) throw rpcError(ErrorCode.InvalidParams, versesOutOfBounds);
  // Die zweite Tür zu derselben Nutzlast, also dieselbe Formprüfung wie in
  // bible_lookup: Sonst verschluckte die Vorlage ein unlesbares Segment weiter,
  // während das Werkzeug es abweist.
  if (segment !== "" && unparsableVersePart(segment) !== null) {
    throw rpcError(ErrorCode.InvalidParams, versesNotParsable);
  }
  if (segment !== "" && reversedVerseRange(segment) !== null) {
    throw rpcError(ErrorCode.InvalidParams, versesReversedRange);
  }
  return segment;
}

function segmentTranslation(segment: string): TranslationCode {
  const resolved = requireTranslation(segment);
  if ("error" in resolved) throw rpcError(ErrorCode.InvalidParams, resolved.error);
  return resolved.code;
}

// --- Ressourcen: Nutzlasten ------------------------------------------------
// Jede der vier festen Ressourcen meldet, was diese Instanz tatsächlich führt,
// nie eine feste Liste: Eine Installation ohne den hebräischen Download böte
// sonst eine Edition an, die sie nicht liefern kann. Dieselbe Regel befolgen die
// Prompts seit 0.5.7.

function booksPayload(): Record<string, unknown> {
  return {
    buecher: stmtBooks.all().map((b) => ({
      nummer: b.book_id,
      name: b.name,
      kapitel: b.chapters,
      testament: b.book_id < 40 ? "AT" : "NT",
    })),
    hinweis:
      "Die Nummern sind die Zählung dieser Datenbank: 1 bis 39 Altes Testament, " +
      "40 bis 66 Neues Testament. Als {buch} in einer URI genügt auch eine " +
      'Abkürzung ("Röm", "1Mo"); aufgelöst wird sie wie bei den Werkzeugen.',
  };
}

/** Die geladenen Übersetzungen in der Reihenfolge der Registry, damit die Ausgabe
 *  stets dieselbe Reihenfolge hat. */
function loadedTranslationCodes(): TranslationCode[] {
  return (Object.keys(TRANSLATIONS) as TranslationCode[]).filter((code) =>
    availableTranslations.has(code)
  );
}

function translationsPayload(): Record<string, unknown> {
  return {
    uebersetzungen: loadedTranslationCodes().map((code) => ({
      kuerzel: code,
      name: TRANSLATIONS[code].name,
      lizenz: TRANSLATIONS[code].license,
      nennung: TRANSLATIONS[code].attribution,
      // Wie `nennung` eine Bedingung, die am Text hängt und nicht am Server,
      // und wie dort ist null eine Aussage: Diese Ausgabe hat keine Grenze.
      verse_max: TRANSLATIONS[code].verseMax,
    })),
    voreinstellung: EFFECTIVE_DEFAULT_TRANSLATION,
    hinweis:
      "Aufgeführt ist, was diese Instanz geladen hat. Steht bei 'nennung' null, " +
      "verlangt die Lizenz keine Namensnennung. Steht bei 'verse_max' eine Zahl, " +
      "gibt der Server aus dieser Ausgabe je Abruf höchstens so viele Verse im " +
      "Wortlaut aus; steht dort null, gibt es keine solche Grenze.",
  };
}

/**
 * Zuerst die AT-Edition, dann die NT-Editionen in der Reihenfolge des
 * Vergleichs. Jeder Eintrag ist ein wörtlicher Schlüssel von EDITION_META, und
 * genau das rechtfertigt das `!` an den Zugriffen unten; eine neue Edition gehört
 * in beide, sonst verliert die Zusicherung ihre Grundlage.
 */
const EDITION_ORDER: readonly string[] = ["wlc", ...NT_EDITION_ORDER];

function editionsPayload(): Record<string, unknown> {
  return {
    editionen: EDITION_ORDER.filter((e) => availableEditions.has(e)).map((e) => {
      const meta = EDITION_META[e]!;
      return {
        kuerzel: e,
        edition: meta.label,
        sprache: meta.sprache,
        hinweis: meta.hinweis,
        lizenz: meta.quelle.lizenz,
        nennung: meta.quelle.nennung,
      };
    }),
    zuordnung:
      "Altes Testament immer 'wlc'. Fürs Neue Testament entscheidet die Angabe " +
      "in der URI, Voreinstellung ist 'byzantine'.",
  };
}

function sourcesPayload(): Record<string, unknown> {
  return {
    quellen: quellen(
      ...loadedTranslationCodes().map(translationQuelle),
      ...EDITION_ORDER.filter((e) => availableEditions.has(e)).map((e) => EDITION_META[e]!.quelle),
      hasXrefs ? DATASET_QUELLEN.crossrefs : undefined,
      hasParallels ? DATASET_QUELLEN.parallelen : undefined,
      hasTagnt ? DATASET_QUELLEN.tagnt : undefined,
      hasStrongDefs ? DATASET_QUELLEN.lexikon_strongs : undefined,
      hasStepCols ? DATASET_QUELLEN.lexikon_step : undefined
    ),
    hinweis:
      "Genannt ist nur, wovon diese Instanz Daten führt. Das Feld 'nennung' ist " +
      "eine Lizenzbedingung, keine Herkunftsnotiz: wer den Text weitergibt, gibt " +
      "sie vollständig mit weiter, samt Adresse. Steht dort null, verlangt die " +
      "Lizenz keine Nennung.",
  };
}

function versesPayload(
  uebersetzung: string,
  buch: string,
  kapitel: string,
  verse: string
): Record<string, unknown> {
  // Dieselbe Reihenfolge wie bei bible_lookup: erst den Namen begrenzen, dann das
  // Kapitel, dann die Versliste, dann auflösen. Siehe requireBookLength.
  requireBookLength(buch);
  const chapter = segmentChapter(kapitel);
  const versesStr = segmentVerses(verse);
  const bookId = segmentBookId(buch);
  const code = segmentTranslation(uebersetzung);

  const payload = lookupPayload(code, bookId, chapter, versesStr, "verse_einzeln");
  if (payload === null) {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Keine Verse für ${buch} ${chapter}${versesStr ? "," + versesStr : ""}. ` +
        "Kapitel- und Versnummern prüfen."
    );
  }
  return payload;
}

function grundtextPayload(
  edition: string,
  buch: string,
  kapitel: string,
  vers: string
): Record<string, unknown> {
  // Dieselbe Reihenfolge wie bei bible_original, aus demselben Grund wie oben.
  requireBookLength(buch);
  const chapter = segmentChapter(kapitel);
  const verse = segmentVerse(vers);
  const bookId = segmentBookId(buch);

  const result = originalPayload(buch, bookId, chapter, verse, edition);
  if ("error" in result) throw rpcError(ErrorCode.InvalidParams, result.error);
  return result.payload;
}

// --- Ressourcen: lesen -----------------------------------------------------
const handleReadResource = async (request: ReadResourceRequest) => {
  const uri = request.params.uri;
  requireData();

  if (uri.length > MAX_URI_LENGTH) {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Die URI darf höchstens ${MAX_URI_LENGTH} Zeichen lang sein.`
    );
  }
  if (!uri.startsWith(URI_SCHEME)) {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Unbekannte URI "${uri}". Die Ressourcen dieses Servers beginnen mit "${URI_SCHEME}".`
    );
  }

  // Von Hand zerlegt, nicht über `new URL()`: Das läse das erste Segment als
  // Autorität und schriebe es klein, "bible://kapitel/SCH/…" käme also mit einem
  // Übersetzungskürzel an, das dieser Server nicht kennt.
  let segments: string[];
  try {
    segments = uri.slice(URI_SCHEME.length).split("/").map(decodeURIComponent);
  } catch {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Die URI "${uri}" enthält eine unvollständige Prozentkodierung. Sonderzeichen ` +
        'im Buchnamen als UTF-8 kodieren (z. B. "R%C3%B6mer").'
    );
  }

  const kind = segments[0] ?? "";
  // Die Art, nie die URI: Die trägt Buch, Kapitel und Vers, also genau den
  // Abfrageinhalt, der nirgends festgehalten wird, und wäre in der Anzahl
  // ihrer Werte nach oben offen.
  zaehleRessource(kind);
  const rest = segments.slice(1);
  let payload: Record<string, unknown>;

  if (kind === "buecher") {
    requireSegments(rest, 0, "bible://buecher");
    payload = booksPayload();
  } else if (kind === "uebersetzungen") {
    requireSegments(rest, 0, "bible://uebersetzungen");
    payload = translationsPayload();
  } else if (kind === "editionen") {
    requireSegments(rest, 0, "bible://editionen");
    payload = editionsPayload();
  } else if (kind === "quellen") {
    requireSegments(rest, 0, "bible://quellen");
    payload = sourcesPayload();
  } else if (kind === "kapitel") {
    const p = requireSegments(rest, 3, "bible://kapitel/{uebersetzung}/{buch}/{kapitel}");
    payload = versesPayload(p[0]!, p[1]!, p[2]!, "");
  } else if (kind === "vers") {
    const p = requireSegments(rest, 4, "bible://vers/{uebersetzung}/{buch}/{kapitel}/{verse}");
    payload = versesPayload(p[0]!, p[1]!, p[2]!, p[3]!);
  } else if (kind === "grundtext") {
    const p = requireSegments(rest, 4, "bible://grundtext/{edition}/{buch}/{kapitel}/{vers}");
    payload = grundtextPayload(p[0]!, p[1]!, p[2]!, p[3]!);
  } else {
    throw rpcError(
      ErrorCode.InvalidParams,
      `Unbekannte Ressource "${uri}". Bekannt sind ` +
        `${RESOURCES.map((r) => r.uri).join(", ")} sowie die Vorlagen ` +
        `${RESOURCE_TEMPLATES.map((t) => t.uriTemplate).join(", ")}.`
    );
  }

  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
};

// --- bible_setup: die Datenbank aus dem Server heraus aufbauen -------------
/**
 * Durch ein ausdrückliches Bestätigungsflag gesichert, statt beim ersten
 * Gebrauch loszulaufen.
 *
 * Der Download dauert rund eine halbe Minute (26 s für acht Schritte, gemessen 29.08.2026) und greift auf acht fremde Quellen zu;
 * das startet man nicht hinter dem Rücken des Nutzers, nur weil ein Modell
 * gerade nach einem Vers gefragt hat. Ohne `bestaetigung` antwortet das Werkzeug
 * mit dem Plan, damit das Modell etwas Handfestes vorlegen kann, bevor es
 * fragt.
 */
async function handleSetup(args: { bestaetigung?: unknown }) {
  // Das Werkzeug aus tools/list herauszuhalten genügt nicht: Ein Aufrufer darf
  // jede Werkzeugbezeichnung schicken, die ihm einfällt, und dieses hier
  // schreibt. Die Abweisung muss im Handler sitzen.
  if (HTTP_MODE) {
    return errorResult(
      "Dieses Werkzeug steht im HTTP-Modus nicht zur Verfügung. Die Datenbank baut " +
        "die Betreiberin oder der Betreiber des Endpunkts auf, nicht der aufrufende Client."
    );
  }

  if (dataMissing === null) {
    return errorResult(
      "Die Datenbank ist bereits vorhanden und vollständig. Es gibt nichts einzurichten."
    );
  }

  // Import hier und nicht auf Modulebene: Er zieht alle neun Download-Module
  // herein, und ein Server, der seine Daten schon hat, soll sie nie laden.
  const { runSetup, SETUP_STEPS } = await import("../scripts/setup.ts");

  if (args.bestaetigung !== true) {
    const plan = {
      status: "bestaetigung_erforderlich",
      grund: dataMissing,
      erklaerung:
        "Die Bibeldaten werden nicht mitgeliefert und müssen einmalig von den " +
        "Originalquellen geladen werden. Frage die Nutzerin oder den Nutzer, ob der " +
        "Download jetzt starten soll, und rufe dieses Werkzeug danach mit " +
        "bestaetigung=true erneut auf.",
      dauer: "etwa eine halbe Minute",
      voraussetzung: "Internetverbindung",
      umfang_mb: 145,
      schritte: SETUP_STEPS.map((s) => ({ schritt: s.label, liefert: s.provides })),
      ziel: DB_PATH,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }] };
  }

  console.error("bible_setup: starting download");
  // Die Download-Skripte melden ihren Fortschritt mit console.log, was auf einer
  // Konsole richtig und hier verhängnisvoll ist: Auf stdout liegt der
  // JSON-RPC-Strom, und eine einzige verirrte Zeile lässt den Client den Server
  // für kaputt halten. Gemessen: Der erste End-to-End-Lauf dieses Werkzeugs
  // lieferte einen unparsbaren Strom. Für die Dauer umgebogen, statt jede
  // Logzeile in acht Skripten umzuschreiben, die auch eigenständig laufen.
  const consoleLog = console.log;
  console.log = console.error;
  let report;
  try {
    report = await runSetup((label, i, total) => {
      console.error(`bible_setup [${i}/${total}] ${label}`);
    });
  } finally {
    console.log = consoleLog;
  }

  const fehlgeschlagen = report.steps.filter((s) => !s.ok);
  const gelungen = report.steps.filter((s) => s.ok).map((s) => s.label);

  if (report.aborted) {
    return errorResult(
      `Der Aufbau ist fehlgeschlagen: ${fehlgeschlagen[0]?.error ?? "unbekannter Fehler"}\n\n` +
        "Ohne die deutschen Übersetzungen entsteht keine Datenbank, deshalb wurden die " +
        "weiteren Schritte übersprungen. Die vorhandenen Daten sind unverändert geblieben. " +
        "Häufigste Ursache ist eine fehlende Internetverbindung; ein erneuter Aufruf " +
        "beginnt von vorn."
    );
  }

  // Ein Neustart ist nötig, weil die Verbindung und ihre vorbereiteten Statements
  // an die leere Datenbank im Speicher gebunden sind, mit der dieser Prozess
  // gestartet ist.
  const result = {
    status: report.complete ? "fertig" : "teilweise_fertig",
    dauer_sekunden: Math.round(report.seconds),
    geladen: gelungen,
    ...(fehlgeschlagen.length > 0
      ? {
          fehlgeschlagen: fehlgeschlagen.map((s) => ({
            schritt: s.label,
            fehler: s.error,
            fehlt_dadurch: s.provides,
            nachholen_mit: s.command,
          })),
          hinweis_unvollstaendig:
            "Die übrigen Daten sind vollständig geladen und nutzbar. Die fehlgeschlagenen " +
            "Schritte lassen sich einzeln nachholen, ohne alles neu zu laden.",
        }
      : {}),
    naechster_schritt:
      "Die Daten liegen jetzt auf der Festplatte. Bitte Claude Desktop einmal vollständig " +
      "beenden und neu starten; erst danach kann dieser Server sie lesen. Gib diesen Satz " +
      "unbedingt weiter.",
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

/**
 * Fassung und Datenbestand dieser Instanz. Die Feldnamen sind deutsch wie in den
 * übrigen Werkzeugnutzlasten. Jeder Wert stammt aus einer Prüfung, die beim
 * Start ohnehin schon lief; der Aufruf kostet also nichts außer dem
 * Serialisieren.
 *
 * Bestand statt Statistik: Eine Gesamtzahl der Verse sagt einem Aufrufer nichts,
 * womit er etwas anfangen könnte, während „hat dieser Server den Grundtext, die
 * Strong-Nummern, die Querverweise" entscheidet, welche Fragen er überhaupt
 * beantworten kann. Die Download-Schritte sind getrennt und je für sich
 * optional, eine Instanz ohne einen davon ist also ein gewöhnlicher Zustand, und
 * die übliche Ursache, wenn ein Werkzeug leer zurückkommt.
 */
// --- bible_server_info: Fassung, Bestand, Voreinstellung -------------------
function handleServerInfo() {
  const result = {
    server: "bibelstudium-mcp",
    version: PACKAGE_VERSION,
    // Lizenz, Nennung und Wortlaut-Grenze stehen zusätzlich in
    // `bible://uebersetzungen`, und sie stehen aus demselben Grund auch hier wie
    // `voreinstellung` darunter: Dieses Werkzeug ist der Kanal, den das Modell
    // nachweislich sieht, eine Ressource liest es womöglich nie. Es sind
    // Bedingungen, die vor dem Abruf gebraucht werden, nicht danach: Wer ein
    // Kapitel plant, muss wissen, dass zwei der Ausgaben je Abruf 20 Verse im
    // Wortlaut hergeben, und wer zitiert, ob ein Dokument eine Namensnennung
    // tragen muss. Beides erschien bis 0.6.12 in keiner Werkzeugantwort außer
    // dem `quellen`-Feld des Abrufs selbst, also erst hinterher.
    //
    // Die drei Felder fehlen bei einem Kürzel, das die Datenbank führt und die
    // Registry nicht kennt; für den Namen greift dort seit je der Rückfall auf
    // das Kürzel, für eine Lizenz gibt es keinen ehrlichen. Deshalb stehen sie
    // nicht in `required`: Ein erfundener Lizenztext wäre schlimmer als ein
    // fehlendes Feld.
    uebersetzungen: [...availableTranslations].sort().map((code) => {
      const meta = TRANSLATIONS[code as TranslationCode] as
        | (typeof TRANSLATIONS)[TranslationCode]
        | undefined;
      return {
        code,
        name: meta?.name ?? code,
        ...(meta !== undefined
          ? { lizenz: meta.license, nennung: meta.attribution, verse_max: meta.verseMax }
          : {}),
      };
    }),
    // Welche Ausgabe ein Abruf ohne `translation` liefert. Die Angabe steht
    // zusätzlich in `bible://uebersetzungen`, aber dieses Werkzeug ist der
    // Kanal, den das Modell nachweislich sieht, und eine Ressource liest es
    // womöglich nie. Ein Endpunkt kann die Vorgabe verschieben; ohne dieses
    // Feld ließe sich von außen nicht feststellen, welche gerade gilt.
    voreinstellung: EFFECTIVE_DEFAULT_TRANSLATION,
    // Dieselbe Gestalt wie `uebersetzungen`, und aus demselben Grund: Die nackten
    // Schlüssel („byzantine", „tr") bezeichnen keine Edition, und ein Aufrufer
    // kann sie in dieser Nutzlast nirgends nachschlagen. Welche Textform geladen
    // ist, entscheidet, welche Fragen diese Instanz überhaupt beantworten kann;
    // der Name gehört also hierher. Die Namen kommen aus EDITION_META, wo Text,
    // Lizenz und hinweis ohnehin beieinander liegen, statt aus einer zweiten
    // Liste, die davon wegliefe. Leer, wenn download-morph.ts nie lief; `?? code`
    // hält eine Edition sichtbar, die die Datenbank führt und die Tabelle nicht
    // kennt, statt sie fallen zu lassen.
    urtext_editionen: originalEditions.map((code) => ({
      code,
      name: EDITION_META[code]?.label ?? code,
    })),
    zusatzdaten: {
      strong_lexikon: hasStrongDefs,
      // Ältere Datenbanken haben strong_defs ohne die STEPBible-Spalten, dann
      // fehlen Gloss und Bedeutung trotz vorhandenem Lexikon.
      strong_lexikon_vollstaendig: hasStepCols,
      // Der einzige Bestandteil dieses Servers, der nicht deutsch antwortet:
      // Beide Quellen des Lexikons sind englisch (Strong über openscriptures,
      // Bedeutung und Gloss aus STEPBible). In einem sonst durchgehend deutschen
      // Ablauf ist das eine Angabe, die vor dem Aufruf zählt, und aus
      // `strong_lexikon: true` allein geht sie nicht hervor. Nur mitgeliefert,
      // wenn es ein Lexikon gibt: eine Sprachangabe zu nicht vorhandenen
      // Einträgen sagt nichts aus.
      ...(hasStrongDefs ? { strong_lexikon_sprache: "en" } : {}),
      editionsbezeugung: hasTagnt,
      querverweise: hasXrefs,
      // Eigenes Merkmal und nicht unter `querverweise` mitgezählt: Die beiden
      // Datensätze sind eigene Setup-Schritte und können einzeln fehlen. Ohne
      // die Anzeige läse ein Aufrufer eine Antwort ohne `parallelen` als „zu
      // diesem Vers gibt es keine Parallelstelle" statt als „dieser Server
      // führt sie nicht".
      parallelstellen: hasParallels,
      volltextsuche: hasFts,
      // Der Anmerkungsapparat erscheint an rund 4 % der Abrufe. Ohne diese
      // Bestandsanzeige könnte ein Aufrufer nicht wissen, dass es ihn überhaupt
      // gibt: Er sähe nur Antworten ohne das Feld und läse das als „diese
      // Ausgabe hat keine Fußnoten".
      fussnoten: hasVerseNotes,
    },
    // Bestand heißt auch: was dieser Server anbietet, nicht nur was er geladen
    // hat. Die vier festen Ressourcen stehen in `resources/list`, die drei
    // Vorlagen nur in `resources/templates/list`, und ob ein Client die
    // überhaupt abruft, ist nicht belegt. Diese Auskunft ist der Kanal, der das
    // Modell nachweislich erreicht (deshalb gibt es sie überhaupt), also stehen
    // die Vorlagen auch hier. Aus denselben Konstanten und mit derselben Sperre
    // wie die Listen, damit beide nicht auseinanderlaufen: eine Instanz ohne
    // Daten meldet hier nichts, was dort nicht abrufbar wäre.
    ressourcen: {
      statisch: dataMissing !== null ? [] : RESOURCES.map((r) => r.uri),
      vorlagen: dataMissing !== null ? [] : RESOURCE_TEMPLATES.map((t) => t.uriTemplate),
    },
    // Welche Bücher es überhaupt geben kann. Die Zahl ist gezählt, nicht
    // behauptet, und die Angabe kam bislang allein aus einer Fehlermeldung: Wer
    // wissen wollte, ob die Apokryphen hier vorkommen, musste einen Fehlgriff
    // provozieren. Ohne Datenbank entfällt sie, statt 0 Bücher zu melden.
    ...(dataMissing === null
      ? {
          kanon: {
            buecher: bookCount,
            umfang:
              "Protestantischer Kanon. Apokryphen und deuterokanonische Schriften " +
              "führt dieser Server nicht.",
          },
        }
      : {}),
    ...(dataFetchedAt !== null ? { daten_stand: dataFetchedAt } : {}),
    ...(dataMissing !== null ? { hinweis: dataMissing } : {}),
  };
  return jsonResult(result);
}

// --- MCP-Server: Verteilung der Anfragen an die Werkzeug-Handler -----------
/**
 * Die Rückgabe ist annotiert, nicht inferiert, und das ist notwendig.
 *
 * Ohne Annotation bildet TypeScript eine Vereinigung aus den Rückgaben aller
 * Handler, und zwei davon tragen kein `isError`: `jsonResult()` und der
 * Planzweig von `handleSetup`. Der Zugriff darauf in der Hülle unten wäre
 * dann TS2339, und `strict` lässt das nicht durchgehen.
 */
const dispatchCallTool = async (request: CallToolRequest): Promise<CallToolResult> => {
  const toolName = request.params.name;
  // `arguments` ist im MCP-Schema optional, und Clients lassen es tatsächlich
  // weg, wenn das Modell ein Werkzeug ohne Parameter aufruft. Ohne diesen
  // Rückfall würfe jeder Handler einen nackten TypeError in die JSON-RPC-Schicht,
  // statt den Werkzeugfehler „Feld erforderlich" zu liefern, mit dem der Aufrufer
  // etwas anfangen kann.
  const rawArgs = request.params.arguments ?? {};

  if (toolName === "bible_setup") {
    return handleSetup(rawArgs as { bestaetigung?: unknown });
  }

  // Vor der dataMissing-Sperre unten beantwortet, und das mit Absicht: Eine
  // Instanz ohne Daten ist genau die Lage, in der jemand fragt, was dieser Server
  // ist und was er hat. „Keine Bibeldatenbank" statt der Fassung zu schicken
  // hielte gerade die erfragte Auskunft zurück.
  if (toolName === "bible_server_info") {
    return handleServerInfo();
  }

  // Eine Sperre für alle datenlesenden Werkzeuge statt einer Prüfung je Handler:
  // Ohne Datenbank antwortete sonst jedes von ihnen „Buch nicht gefunden", was
  // sich liest, als sei die Stellenangabe falsch, und nicht, als sei noch nichts
  // geladen.
  if (dataMissing !== null) {
    // Zwei Adressaten, zwei Meldungen. Über stdio kann der Aufrufer das beheben,
    // also das Werkzeug nennen, das es tut. Über HTTP ist er ein Fremder ohne
    // Zugriff auf die Maschine: Auf bible_setup zu zeigen würde ein Werkzeug
    // benennen,
    // das dort nicht angeboten wird und sich nicht verwenden lässt. Die eine
    // Anweisung, die in beiden Fällen trägt, ist der letzte Satz.
    return errorResult(
      HTTP_MODE
        ? `${dataMissing} Dieser Endpunkt hat derzeit keine Bibeldaten und kann keine ` +
            "Stelle nachschlagen. Das lässt sich nur serverseitig beheben; ein erneuter " +
            "Aufruf hilft nicht. Beantworte die Bibelfrage nicht aus dem Gedächtnis, " +
            "sondern sage, dass der Bibelserver derzeit keine Daten hat."
        : `${dataMissing} Dieser Server bringt die Bibeldaten nicht mit, sie werden einmalig ` +
            "von den Originalquellen geladen (etwa eine halbe Minute, Internetverbindung nötig).\n\n" +
            "Frage die Nutzerin oder den Nutzer, ob der Download jetzt starten soll, und rufe " +
            "dann bible_setup mit bestaetigung=true auf. Beantworte die Bibelfrage bis dahin " +
            "nicht aus dem Gedächtnis."
    );
  }

  if (toolName === "bible_original") {
    return handleOriginal(
      rawArgs as {
        book?: unknown;
        chapter?: unknown;
        verse?: unknown;
        texttyp?: unknown;
      }
    );
  }
  if (toolName === "bible_crossrefs") {
    return handleCrossrefs(
      rawArgs as {
        book?: unknown;
        chapter?: unknown;
        verse?: unknown;
        limit?: unknown;
        translation?: unknown;
      }
    );
  }
  if (toolName === "bible_concordance") {
    return handleConcordance(
      rawArgs as {
        strong?: unknown;
        lemma?: unknown;
        texttyp?: unknown;
        limit?: unknown;
      }
    );
  }
  if (toolName === "bible_search") {
    return handleSearch(
      rawArgs as {
        query?: unknown;
        book?: unknown;
        limit?: unknown;
        translation?: unknown;
      }
    );
  }
  if (toolName === "bible_compare") {
    return handleCompare(
      rawArgs as {
        book?: unknown;
        chapter?: unknown;
        verse?: unknown;
      }
    );
  }
  if (toolName !== "bible_lookup") {
    // InvalidParams, nicht InternalError: Das eigene Beispiel der Spezifikation
    // für diesen Fall lautet `{"code": -32602, "message": "Unknown tool: …"}`
    // (server/tools), und der hochsprachige McpServer des SDK wirft genau das
    // (server/mcp.js:104). Die Werkzeuge oben beantworten Eingabefehler
    // stattdessen mit `isError`; dieser Kanal braucht ein Werkzeug, das es gibt,
    // und dies ist der eine Fall, in dem es keines gibt.
    throw rpcError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
  }

  return handleLookup(rawArgs);
};

/**
 * Zählt jeden Werkzeugaufruf und lässt die Kette darunter unberührt.
 *
 * Als Hülle statt als Zeile im Dispatch, weil dessen Reihenfolge trägt: Die
 * `dataMissing`-Sperre steht vor den Lesewerkzeugen, und der Wurf für einen
 * unbekannten Namen steht als Negation dahinter, damit eine Instanz ohne Daten
 * auch auf einen falschen Namen den Setup-Hinweis liefert und nicht `-32602`.
 * Wer dort etwas einfügt, fällt leicht in eine Umsortierung, die kein Test
 * bemerkt.
 *
 * Die drei Ausgänge sind die drei Antwortarten dieses Servers: ein Ergebnis,
 * ein Werkzeugfehler mit `isError`, ein geworfener JSON-RPC-Fehler. Der vierte
 * Fall ist keiner davon: `handleSetup` fährt die Download-Skripte, dort kommen
 * Netz- und Dateisystemfehler als nacktes `Error` an. Sie als `abgewiesen` zu
 * buchen verwischte genau den Unterschied, dessentwegen gezählt wird.
 */
const handleCallTool = async (request: CallToolRequest): Promise<CallToolResult> => {
  const name = request.params.name;
  try {
    const ergebnis = await dispatchCallTool(request);
    zaehleWerkzeug(name, ergebnis.isError === true ? "fehler" : "ok");
    return ergebnis;
  } catch (fehler) {
    // `rpcError()` setzt ein numerisches `code`; ein nacktes `Error` hat keines.
    const abgewiesen =
      typeof fehler === "object" &&
      fehler !== null &&
      typeof (fehler as { code?: unknown }).code === "number";
    zaehleWerkzeug(name, abgewiesen ? "abgewiesen" : "ausnahme");
    throw fehler;
  }
};

// --- MCP-Server: Aufbau und Werkzeug-Registrierung -------------------------
// Registriert wird auf Modulebene, also vor der ersten Anfrage. Erst dadurch
// steht jeder Zähler von Anfang an auf null, statt beim ersten Aufruf aus dem
// Nichts aufzutauchen. Die Werkzeugnamen stehen in `metriken.ts`, die
// Prompt- und Ressourcennamen leiten sich aus den Tabellen ab, die es hier
// ohnehin gibt, und können deshalb nicht auseinanderlaufen.
registriereWerkzeuge(WERKZEUG_NAMEN);
registrierePrompts(PROMPTS.map((p) => p.name));
// Das erste Segment hinter dem Schema ist die Art, und genau darauf prüft
// `handleReadResource`. Zwei Zugriffe, weil die feste Liste ihre Adresse unter
// `uri` führt und die Vorlagen unter `uriTemplate`.
registriereRessourcen([
  ...RESOURCES.map((r) => r.uri.slice(URI_SCHEME.length).split("/")[0] ?? ""),
  ...RESOURCE_TEMPLATES.map((t) => t.uriTemplate.slice(URI_SCHEME.length).split("/")[0] ?? ""),
]);
// Die Version wird angemeldet wie die Namen darüber, damit `metriken.ts` nichts
// aus dieser Datei zurückimportieren muss. Sie steht neben dem Startzeitpunkt
// in der Ausgabe und beantwortet dort, welcher Stand die Zähler gefüllt hat.
registriereProzess(PACKAGE_VERSION);

// Eine Fabrik, kein Singleton: Ein `Server` bindet genau einen Transport, der
// HTTP-Modus unten braucht deshalb je Anfrage eine frische Instanz. Alles
// Teure (Datenbank, vorbereitete Statements, die Werkzeugliste) liegt auf
// Modulebene und wird geteilt; eine Instanz ist nur die Verdrahtung der Handler.
function createServer(): Server {
  const s = new Server(
    // Version aus package.json, nicht daneben gepflegt: sie lief bereits
    // auseinander. Der v0.3.0-Commit hob die Zahl hier von 0.2.1 auf 0.2.2,
    // während das Paket auf 0.3.0 ging, und jeder Client sah seither im
    // initialize eine Version, die es als Release nicht gibt. Der Import
    // funktioniert unter `bun run` und im kompilierten Binary gleichermaßen
    // (beides geprüft); build-mcpb.ts liest dieselbe Datei für das Manifest.
    { name: "bibelstudium-mcp", version: PACKAGE_VERSION },
    {
      // Kein `subscribe` und kein `listChanged` bei den Ressourcen: Der Bestand
      // steht für die Lebensdauer des Prozesses fest, und Subscriptions führt
      // Anthropics Connector-Dokumentation ausdrücklich als nicht unterstützt.
      // Eine angekündigte Fähigkeit, die niemand bedient, ist ein Versprechen
      // an den Client, das der Server nicht hält.
      capabilities: { tools: {}, prompts: {}, resources: {} },
      // Version auch hier, nicht nur in serverInfo: das initialize trägt sie
      // ohnehin, aber kein Client zeigt sie an, und ein Bug-Report ohne
      // Versionsangabe kostet eine Rückfrage.
      //
      // Dieses Feld allein genügt dafür nicht: Claude Desktop reicht weder das
      // initialize-Result noch instructions an das Modell durch (gemessen am
      // 26.07.2026 in zwei Sitzungen). Im Chat ist die Frage hierüber also
      // nicht beantwortbar, und genau deshalb gibt es bible_server_info, dessen
      // Ergebnis das Modell sicher sieht. Gesetzt bleibt es trotzdem: andere
      // Clients dürfen es durchreichen, und es kostet keine tools/list.
      // Wer hier etwas ändert, ändert es dort mit.
      //
      // Dieselbe einzige Quelle wie serverInfo und das MCPB-Manifest, sie kann
      // also nicht auseinanderlaufen.
      instructions:
        `bibelstudium-mcp server, version ${PACKAGE_VERSION}. ` +
        `Quote scripture only from the bible_* tools, never from memory. ` +
        `When asked which server or MCP version is running, report this version.`,
    }
  );
  s.setRequestHandler(ListToolsRequestSchema, handleListTools);
  s.setRequestHandler(ListPromptsRequestSchema, handleListPrompts);
  s.setRequestHandler(GetPromptRequestSchema, handleGetPrompt);
  s.setRequestHandler(ListResourcesRequestSchema, handleListResources);
  s.setRequestHandler(ListResourceTemplatesRequestSchema, handleListResourceTemplates);
  s.setRequestHandler(ReadResourceRequestSchema, handleReadResource);
  s.setRequestHandler(CallToolRequestSchema, handleCallTool);
  return s;
}

// --- Bootstrap -------------------------------------------------------------

async function main(): Promise<void> {
  /**
   * Baut die Datenbank auf und endet: das Gegenstück zu bible_setup für die
   * Betreiberseite.
   *
   * Nötig, weil es bible_setup nur über stdio gibt (siehe HTTP_MODE): Ohne dieses
   * Flag verlangte das Einrichten eines HTTP-Endpunkts Bun und einen Checkout auf
   * dem Zielrechner, und der ganze Sinn des kompilierten Binaries ist, dass
   * beides dort nicht liegt.
   *
   * Das Flag wird auf Modulebene gelesen (SETUP_CLI), weil das Startprotokoll
   * dort ebenfalls davon wissen muss; argv ist bei `bun run server.ts` anders
   * indiziert als bei einem kompilierten Binary, deshalb wird es mit `includes`
   * gesucht statt an fester Stelle, und so trägt es in beiden Fällen.
   */
  if (SETUP_CLI) {
    // Anders als bible_setup lehnt diese Flagge bei vorhandener Datenbank nicht
    // ab: sie ist der Weg, Daten auch zu erneuern. Dann aber sagen, was passiert.
    if (dataMissing === null) {
      console.log(`Es liegt bereits eine Datenbank unter ${DB_PATH}. Sie wird neu aufgebaut.`);
    }
    const { runSetup } = await import("../scripts/setup.ts");
    const report = await runSetup((label, i, total) => {
      console.log(`[${i}/${total}] ${label}`);
    });
    for (const step of report.steps) {
      console.log(`${step.ok ? "ok  " : "FEHL"} ${step.label} (${step.seconds.toFixed(1)}s)`);
      if (!step.ok) console.log(`     ${step.error}. Nachholen mit: ${step.command}`);
    }
    console.log(`Ziel: ${DB_PATH}`);
    if (report.aborted) {
      console.error("Abgebrochen: ohne die Übersetzungen gibt es keine Datenbank.");
      process.exit(1);
    }
    return;
  }

  const portRaw = process.env["MCP_HTTP_PORT"];
  if (portRaw !== undefined && portRaw !== "") {
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`MCP_HTTP_PORT ist keine gültige Portnummer: ${portRaw}`);
    }
    serveMetrics();

    // Die Schlussbilanz ins Journal, bevor der Prozess endet. Sie ersetzt keine
    // Persistenz: Die Zähler laufen seit Prozessstart, ein Neustart setzt sie
    // auf null, und was zwischen dem letzten Abruf der Überwachung und dem Ende
    // gezählt wurde, war bisher spurlos verloren.
    //
    // **Nur im HTTP-Betrieb, und das ist keine Sparsamkeit.** Dort schreibt
    // stderr ins Journal des Dienstes. Über stdio leitet ein Desktop-Client
    // stderr in eine Datei auf dem Rechner der Nutzerin um; die Zählstände
    // stünden dort dauerhaft, und eine Datei zu schreiben ist genau das, was
    // dieser Server nicht tut. Ein SIGINT-Handler nähme außerdem jedem lokalen
    // `bun run src/server.ts` das Strg-C.
    //
    // **`process.exit(0)` ist zwingend, nicht Beiwerk.** Ein registrierter
    // Signalhandler ersetzt die Beendigung, er ergänzt sie nicht: Ohne den Exit
    // liefe der Prozess weiter, `proc.kill()` in den Tests hinterließe Zombies
    // auf dem Testport, und aus `systemctl restart` würde ein SIGKILL nach
    // Ablauf der Stoppfrist (gemessen 23.08.2026).
    //
    // Die Zeile überlebt den unmittelbaren Exit: 3008 von 3008 Byte, auf eine
    // Pipe wie in eine Datei (ebenfalls gemessen 23.08.2026). Ein Umweg über
    // fs.writeSync oder den nächsten Tick ist deshalb nicht nötig.
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        console.error(bilanzZeile(PACKAGE_VERSION));
        process.exit(0);
      });
    }

    await serveHttp(port, createServer);
    return;
  }
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error("Bibelstudium MCP server running on stdio");
}

main().catch((error) => {
  console.error("Bibelstudium MCP server failed to start:", error);
  process.exit(1);
});
