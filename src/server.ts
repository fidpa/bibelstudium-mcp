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
 * Ressourcen, bible_setup, Dispatch, Bootstrap. Die Werkzeuge selbst stehen
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
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
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
  GetPromptRequest,
  ReadResourceRequest,
} from "@modelcontextprotocol/sdk/types.js";
import packageJson from "../package.json";
import { DB_PATH } from "./db-path.ts";
import {
  HTTP_MODE,
  SETUP_CLI,
  availableEditions,
  availableTranslations,
  dataFetchedAt,
  dataMissing,
  db,
  hasFts,
  hasStepCols,
  hasStrongDefs,
  hasTagnt,
  hasVerseNotes,
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
  DEFAULT_TRANSLATION,
  TRANSLATIONS,
  resolveTranslation,
  type TranslationCode,
} from "./translations.ts";
import {
  MAX_BOOK_LENGTH,
  MAX_CHAPTER,
  MAX_VERSE,
  MAX_VERSES_LENGTH,
  MAX_VERSE_PARTS,
  bookNotFoundMessage,
  bookTooLong,
  chapterOutOfRange,
  errorResult,
  jsonResult,
  lookupPayload,
  originalPayload,
  requireTranslation,
  resolveBook,
  rpcError,
  toInt,
  verseOutOfRange,
  unparsableVersePart,
  versesNotParsable,
  versesOutOfBounds,
  versesTooLong,
  versesTooManyParts,
} from "./werkzeug-helfer.ts";
import { handleCompare } from "./handlers/compare.ts";
import { handleConcordance } from "./handlers/concordance.ts";
import { handleCrossrefs } from "./handlers/crossrefs.ts";
import { handleLookup } from "./handlers/lookup.ts";
import { handleOriginal } from "./handlers/original.ts";
import { handleSearch } from "./handlers/search.ts";

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

/** Bedingt, drei Felder:
 *  `hinweis`, nur wenn der Text Wörter in Klammern trägt (Menge 137 Verse,
 *  Schlachter 2000 1925; Luther, Schlachter 1951 und Elberfelder keine) oder
 *  wenn die Wortlaut-Grenze gegriffen hat. Das Feld hat seit der Grenze zwei
 *  Ursachen, es kann also auch ohne Klammerverse dastehen.
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
  required: ["reference", "translation", "text", "quellen"],
};

/** Bedingt: `woerter[].strong`, fehlt bei allen 137 554 SBLGNT-Wörtern und bei
 *  5951 WLC-Wörtern; byzantine und tr führen es durchgängig. */
const ORIGINAL_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
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
  required: ["reference", "texttyp", "edition", "sprache", "hinweis", "woerter", "quellen"],
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
 *  `gekuerzt` wie in bible_lookup. */
const CROSSREFS_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
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
    lesehinweis: { type: "string" },
    hinweis: { type: "string" },
    gekuerzt: GEKUERZT_SCHEMA,
    quellen: QUELLEN_SCHEMA,
  },
  required: ["reference", "gesamt", "verweise", "quellen"],
};

/** Bedingt: die sechs Lexikonfelder (`strong`, `umschrift`, `kurzbedeutung`,
 *  `bedeutung`, `kjv_woerter`, `lexikon`; das letzte gibt es nur im
 *  Griechischen, und alle setzen voraus, dass strong_defs geladen ist und einen
 *  Eintrag führt), sowie `hinweis`, nur wenn `limit` die Vorkommensliste
 *  gekürzt hat. */
const CONCORDANCE_OUTPUT = {
  type: "object" as const,
  properties: {
    suche: { type: "string" },
    grundform: { type: "string" },
    strong: { type: "string" },
    umschrift: { type: "string" },
    kurzbedeutung: { type: "string" },
    bedeutung: { type: "string" },
    kjv_woerter: { type: "string" },
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
 *  NT-Verse haben überhaupt keine Zeile), und darin `lesehinweis`,
 *  `bedeutungsvariante`, `schreibvariante`, `in_dieser_db`, `abgleich`.
 *  `vergleiche[]` hat zwei Gestalten, deshalb ist allein `paar` erforderlich. */
const COMPARE_OUTPUT = {
  type: "object" as const,
  properties: {
    reference: { type: "string" },
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
  required: ["reference", "sprache", "editionen", "vergleiche", "hinweis", "quellen"],
};

/** Bedingt: `daten_stand`, erst wenn ein Download eine Herkunft vermerkt hat;
 *  `hinweis`, nur solange die Datenbank fehlt. */
const SERVER_INFO_OUTPUT = {
  type: "object" as const,
  properties: {
    server: { type: "string" },
    version: { type: "string" },
    uebersetzungen: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, name: { type: "string" } },
        required: ["code", "name"],
      },
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
        editionsbezeugung: { type: "boolean" },
        querverweise: { type: "boolean" },
        volltextsuche: { type: "boolean" },
        fussnoten: { type: "boolean" },
      },
      required: [
        "strong_lexikon", "strong_lexikon_vollstaendig", "editionsbezeugung",
        "querverweise", "volltextsuche", "fussnoten",
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
    daten_stand: { type: "string" },
    hinweis: { type: "string" },
  },
  required: [
    "server", "version", "uebersetzungen", "urtext_editionen", "zusatzdaten", "ressourcen",
  ],
};

// Die sieben Lesewerkzeuge lesen nur: eine lokale SQLite-Datei, nur lesend
// geöffnet, keine Schreibvorgänge, keine Nebenwirkungen, kein Netz. Beide
// Vorgabewerte der Spezifikation sind hier falsch (readOnlyHint steht auf false,
// openWorldHint auf true), deshalb stehen beide ausdrücklich da. destructiveHint
// und idempotentHint bleiben bewusst draußen: Das Schema erklärt sie nur dann
// für bedeutsam, wenn readOnlyHint false ist.
const READ_ONLY_LOCAL = { readOnlyHint: true, openWorldHint: false } as const;

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
        "translation (default: Luther 1912). Use this for ALL Bible quotes — never quote " +
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
          translation: {
            type: "string",
            description:
              'Translation: "LUT" (Luther 1912, default), "SCH" (Schlachter 1951), ' +
              '"ELB" (Elberfelder 1871), "MB" (Menge 1939), "SLT" (Schlachter 2000). ' +
              'Aliases like "luther", "schlachter" accepted.',
            default: "LUT",
          },
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
        "relevance votes, with the German text of the targets (default: Luther 1912; in editions " +
        "that cap verbatim quoting, the later targets carry `stelle` and `votes` only). Use this " +
        "to find where a theme, quote or promise recurs elsewhere in Scripture. Data: Treasury of " +
        "Scripture Knowledge (expanded), OpenBible.info, CC-BY.",
      inputSchema: {
        type: "object" as const,
        properties: {
          book: {
            type: "string",
            description: 'Book name in German (e.g. "Jesaja", "1. Mose", "Römer")',
          },
          chapter: { type: "number", description: "Chapter number" },
          verse: { type: "number", description: "Single verse number" },
          limit: {
            type: "number",
            description: "Maximum number of references to return (default 10, max 30)",
            default: 10,
          },
          translation: {
            type: "string",
            description:
              'Translation for the quoted target texts: "LUT" (default), "SCH", "ELB", "MB", "SLT".',
            default: "LUT",
          },
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
          limit: {
            type: "number",
            description: "Maximum occurrences to list (default 50, max 200); counts are always exact",
            default: 50,
          },
        },
        required: [],
      },
      outputSchema: CONCORDANCE_OUTPUT,
    },
    {
      name: "bible_search",
      annotations: READ_ONLY_LOCAL,
      description:
        "Full-text search over the German Bible text (default: Luther 1912). Finds verses " +
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
          limit: {
            type: "number",
            description: "Maximum verses to return (default 10, max 50); the total count is always exact",
            default: 10,
          },
          translation: {
            type: "string",
            description: 'Translation to search: "LUT" (default), "SCH", "ELB", "MB", "SLT".',
            default: "LUT",
          },
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
        "Report this server's own release version and which Bible data it has loaded. " +
        "Use when asked which version runs, or when collecting facts for a bug report. " +
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
function promptArg(args: Record<string, string>, name: string, required: boolean): string {
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
  const args = (request.params.arguments ?? {}) as Record<string, string>;

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
      `3. Wähle 2 bis 3 Vorkommen aus, und zwar nach der Verteilung in 'buecher' (verschiedene Bücher, auffällige Häufungen), nicht nach Bekanntheit. Rufe für sie bible_lookup ab${hasXrefs ? " und bible_crossrefs für die Parallelstellen" : ""}.\n` +
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
// MAX_VERSES_LENGTH, die Trennzeichen, und ein Faktor drei, weil die
// Prozentkodierung aus einem Nicht-ASCII-Zeichen bis zu neun macht (drei
// UTF-8-Bytes zu je drei Zeichen). Wie MAX_VERSES_LENGTH kann auch diese Grenze
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
    voreinstellung: DEFAULT_TRANSLATION,
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
 * Der Download dauert rund eine Minute und greift auf acht fremde Quellen zu;
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

  // Import hier und nicht auf Modulebene: Er zieht alle acht Download-Module
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
      dauer: "ungefähr eine Minute",
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
function handleServerInfo() {
  const result = {
    server: "bibelstudium-mcp",
    version: PACKAGE_VERSION,
    uebersetzungen: [...availableTranslations].sort().map((code) => ({
      code,
      name: TRANSLATIONS[code as TranslationCode]?.name ?? code,
    })),
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
      editionsbezeugung: hasTagnt,
      querverweise: hasXrefs,
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
    ...(dataFetchedAt !== null ? { daten_stand: dataFetchedAt } : {}),
    ...(dataMissing !== null ? { hinweis: dataMissing } : {}),
  };
  return jsonResult(result);
}

// --- MCP-Server: Verteilung der Anfragen an die Werkzeug-Handler -----------
const handleCallTool = async (request: CallToolRequest) => {
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
            "von den Originalquellen geladen (etwa eine Minute, Internetverbindung nötig).\n\n" +
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

// --- MCP-Server: Aufbau und Werkzeug-Registrierung -------------------------
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
/**
 * HTTP-Modus, zuzuschalten über MCP_HTTP_PORT. Ohne die Variable spricht der
 * Server stdio wie bisher; lokale Clients und `bun run test` sind also nicht
 * betroffen.
 *
 * Gebunden wird an 127.0.0.1, sofern MCP_HTTP_HOST nichts anderes sagt. Diese
 * Vorgabe ist der sicherheitsrelevante Teil: Diesen Server von außen zu
 * erreichen soll einen bewussten Schritt verlangen (einen Tunnel oder einen
 * Reverse Proxy, der TLS abschließt) und nie eine vergessene Voreinstellung.
 * Den Port unmittelbar zu veröffentlichen gäbe zudem die Adresse der Maschine
 * preis, und weder TLS noch Zugriffsschutz bringt der Server mit.
 *
 * Zustandslos: `Server` bindet einen einzigen Transport, jede Anfrage bekommt
 * deshalb aus createServer() ihre eigene Instanz. Datenbank und alle
 * vorbereiteten Statements bleiben auf Modulebene geteilt, eine Anfrage kostet
 * also kaum mehr als das Verdrahten der Handler.
 */
// CORS, damit auch browserbasierte Clients den Endpunkt nutzen können. Für
// MCP-Clients ohne Browser ist es folgenlos: die schicken keinen Origin. Kein
// Widerspruch zur Origin-Prüfung unten: Die entscheidet, WER antworten
// bekommt, diese Kopfzeilen sagen dem Browser nur, was er damit tun darf.
//
// 'expose' nennt die Sitzungs-ID aus der Zeit vor dem zustandslosen Umbau.
// Dieser Server vergibt keine und sendet die Kopfzeile nie, ein Browser bekommt
// hier also nichts freigegeben, was es gibt. Die Zeile steht folgenlos und wird
// mit dem Umstieg auf die Revision 2026-07-28 fällig, die das Feld ganz
// streicht ("do not mint or echo session IDs").
const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

/**
 * Die erlaubten Methoden je Pfad, und zwar genau einmal hingeschrieben.
 *
 * Sie erscheinen an zwei Stellen, die auseinanderlaufen können und es hier
 * bereits taten: in `Allow` einer 405 (von RFC 9110 verlangt) und in
 * `access-control-allow-methods` der Vorabanfrage. Am 03.08.2026 meldete
 * derselbe Pfad drei verschiedene Listen: `GET /mcp` antwortete mit
 * `Allow: POST, OPTIONS`, `PUT` und `PATCH` bekamen vom SDK
 * `Allow: GET, POST, DELETE`, und die Vorabanfrage nannte
 * `GET, POST, DELETE, OPTIONS`. Aus einer Konstante gespeist kann das nicht
 * wieder vorkommen.
 *
 * Deshalb steht die Angabe auch nicht mehr in CORS_HEADERS: Die gilt für jede
 * Antwort, die Methodenliste aber je Pfad. Global gesetzt behauptete sie
 * zwangsläufig für einen der beiden Pfade etwas Falsches.
 */
const METHODS_MCP = "POST, OPTIONS";
const METHODS_HEALTH = "GET, HEAD, OPTIONS";

/**
 * Warum /health die Datenbank abfragt, statt `dataMissing` zu melden.
 *
 * `dataMissing` wird einmal beim Start entschieden. Eine Datei, die im
 * laufenden Betrieb getauscht oder beschädigt wird, ließe den Wert auf `null`
 * stehen, und /health meldete weiter „ok" für einen Server, der keine einzige
 * Stelle mehr nachschlagen kann. Die billigste Abfrage, die den ganzen Weg als
 * funktionierend nachweist, ist eine Zeile aus der Tabelle, die jedes Werkzeug
 * braucht; sie kommt aus dem Seiten-Cache von SQLite und kostet Mikrosekunden,
 * eine Überwachung darf sie also regelmäßig aufrufen.
 *
 * Liefert null im gesunden Fall, sonst den Grund, damit der Aufrufer etwas hat,
 * das er in den Antwortrumpf legen kann.
 */
function healthProblem(): string | null {
  if (dataMissing !== null) return dataMissing;
  try {
    const row = db.query("SELECT COUNT(*) AS n FROM books").get() as { n: number } | null;
    if (row === null || row.n === 0) return "Die Datenbank antwortet, enthält aber keine Bücher.";
    return null;
  } catch (error) {
    return `Die Datenbank ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * `methods` ist Pflicht und hat bewusst keinen Vorgabewert.
 *
 * Ein Vorgabewert würde genau den Fehler konservieren, den die Aufteilung
 * behebt: Eine vergessene Aufrufstelle bekäme stillschweigend eine
 * Methodenliste, die für ihren Pfad nicht gilt. So scheitert stattdessen der
 * Typecheck. `null` heißt „für diese Antwort gibt es keine Methodenliste" und
 * lässt die Kopfzeile weg; das ist der richtige Wert für 403 und 404, wo es
 * entweder keinen Pfad gibt oder der Aufrufer ihn nicht sehen soll.
 */
function withCors(response: Response, methods: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  if (methods !== null) headers.set("access-control-allow-methods", methods);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Warum der Endpunkt festhält, welche Protokollrevision seine Aufrufer sprechen.
 *
 * Die Revision 2026-07-28 hat `initialize` und die Sitzung abgeschafft: Ein
 * moderner Client trägt Version, Identität und Fähigkeiten im `_meta` jeder
 * Anfrage und spiegelt die Version in die Kopfzeile `MCP-Protocol-Version`.
 * Dieser Server läuft auf dem 1.x-SDK und spricht allein die Revisionen mit
 * Handschlag; nach der Verträglichkeitsmatrix der Spezifikation scheitert ein
 * moderner Client also entweder rundweg oder, schlimmer, bekommt eine in der
 * Ära mehrdeutige Methode unter der alten Bedeutung bedient: Der zustandslose
 * POST-Pfad nimmt Anfragen ohne Handschlag an, hier fiele es also niemandem
 * auf. Der Umstieg auf das v2-SDK ist eine Paketteilung samt Neufassung jeder
 * Handler-Registrierung; der Auslöser sollte deshalb ein gemessener Client sein
 * und kein Datum. Dies ist diese Messung.
 *
 * Eine Zeile je Protokollversion, nicht je Anfrage und nicht je Client. Der
 * Endpunkt ist öffentlich und authlos: Eine Zeile je Anfrage wäre ein
 * Zugriffsprotokoll, nach dem niemand gefragt hat, und ein müheloser Weg, das
 * Journal zu füllen. Die Menge ist gedeckelt, aus demselben Grund, aus dem die
 * Sitzungsregistratur verschwunden ist: Sie wächst mit Eingaben des Aufrufers,
 * und eine ungedeckelte ist genau das Leck, das dieser Server schon einmal
 * hatte.
 *
 * Nichts vom Aufrufer wird wörtlich geschrieben. Die Version wird gegen das
 * Format einer Revision geprüft, nicht bloß gesäubert, und der selbstgemeldete
 * Name des Clients wird gar nicht festgehalten. Beides folgt aus der
 * Datenschutzerklärung, die dieser Endpunkt veröffentlicht und die
 * Betriebsereignisse „ohne Personenbezug" zusagt: Ein Versprechen über freien
 * Text von Fremden hält immer nur das Wohlwollen ihrer Software, während ein
 * Wert, der vor dem Journal gegen `YYYY-MM-DD` geprüft wird, konstruktiv
 * gehalten ist. Sowohl die Kopfzeile `Mcp-Protocol-Version` als auch
 * `params.protocolVersion` bestimmt der Aufrufer, und in beide passt eine
 * Adresse oder ein Name.
 */
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
/**
 * Die erste Revision, die Version und Identität je Anfrage trägt. Revisionen
 * heißen nach ISO-Daten, ein Zeichenkettenvergleich ordnet sie also, und `>=`
 * ist die Prüfung auf die Ära.
 */
const FIRST_MODERN_REVISION = "2026-07-28";
const MAX_PROTOCOL_SIGHTINGS = 20;
const protocolSightings = new Set<string>();
let modernLogged = false;

/** Steht für eine Angabe, die kein Revisionsname ist, damit kein solcher Wert ins Protokoll gerät. */
const UNKNOWN_REVISION = "unbekannte Angabe";

/**
 * Eine Protokollrevision heißt nach ihrem Erscheinungsdatum. Alles andere wird
 * abgewiesen statt gesäubert: Dies ist der einzige Wert aus der Anfrage, der ins
 * Journal gelangt, und deshalb lohnt es sich, ihn auf eine Form festzulegen, die
 * weder eine Botschaft noch eine Kennung noch ein Steuerzeichen tragen kann.
 */
function asRevision(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function noteProtocolVersion(request: Request): Promise<void> {
  // Der billige Weg, den jede Anfrage nimmt, sobald eine Version einmal gesehen
  // ist: ein Blick in die Kopfzeilen und einer in die Menge, ohne den Rumpf zu
  // lesen.
  const headerRevision = asRevision(request.headers.get("mcp-protocol-version"));

  // Sichtungen aus der modernen Ära fallen in eine einzige Zeile zusammen, die
  // älteren werden nach Version geführt. Das Brauchbare an einem modernen
  // Aufrufer ist, dass es ihn gibt, und nicht, welches Datum er nennt; sie nach
  // Version zu führen gäbe einem authlosen Aufrufer beides: eine Zeile je
  // erfundenem Zukunftsdatum und einen Weg, die echte Sichtung aus der
  // gedeckelten Menge zu verdrängen. Gemessen am 28.07.2026: Zwanzig
  // vorgetäuschte Daten erzeugten zwanzig Warnungen und verschluckten dann den
  // echten Client vom 2026-07-28.
  const headerModern = headerRevision !== null && headerRevision >= FIRST_MODERN_REVISION;
  if (headerModern && modernLogged) return;
  if (!headerModern) {
    if (headerRevision !== null && protocolSightings.has(headerRevision)) return;
    if (protocolSightings.size >= MAX_PROTOCOL_SIGHTINGS) return;
  }

  let bodyRevision: string | null = null;
  let modernMeta = false;
  let discover = false;

  // Den Rumpf nur für eine noch nicht vermerkte Version lesen, also höchstens
  // einmal je Version. Die Kopfzeile fehlt genau bei einem alten `initialize`
  // und bei Clients vor 2025-06-18, die sie nie definiert haben.
  try {
    const body = asRecord(await request.clone().json());
    if (body !== null) {
      discover = body["method"] === "server/discover";
      const params = asRecord(body["params"]);
      if (params !== null) {
        // Alte Ära: `initialize` nennt die Version in params.
        bodyRevision = asRevision(params["protocolVersion"]);
        // Moderne Ära: Jede Anfrage nennt sie stattdessen in _meta.
        const meta = asRecord(params["_meta"]);
        if (meta !== null && typeof meta[META_PROTOCOL_VERSION] === "string") {
          modernMeta = true;
          bodyRevision = asRevision(meta[META_PROTOCOL_VERSION]);
        }
      }
    }
  } catch {
    // Kein JSON, oder ein Rumpf, den dieser Server ohnehin abweist. Die
    // Kopfzeile allein bezeichnet die Ära weiterhin, und ein Fehlschlag hier darf
    // die Anfrage nicht scheitern lassen.
  }

  const revision = bodyRevision ?? headerRevision;
  // `server/discover` gibt es nur in der modernen Ära, die Methode bezeichnet sie
  // also auch dann, wenn ein Aufrufer die Version weglässt.
  const modern = modernMeta || discover || (revision !== null && revision >= FIRST_MODERN_REVISION);
  // Ein Aufrufer, der keine gültige Revision nennt, wird trotzdem gezählt, aber
  // unter einer festen Bezeichnung: Seine eigene Zeichenkette darf nicht ins
  // Journal.
  const shown = revision ?? UNKNOWN_REVISION;

  if (modern) {
    if (modernLogged) return;
    modernLogged = true;
  } else {
    if (protocolSightings.has(shown)) return;
    if (protocolSightings.size >= MAX_PROTOCOL_SIGHTINGS) return;
    protocolSightings.add(shown);
    if (headerRevision !== null) protocolSightings.add(headerRevision);
  }

  if (modern) {
    console.error(
      `MCP-Protokoll: ${shown} (zustandslose Revision). ` +
        "Dieser Server spricht sie nicht: er läuft auf dem 1.x-SDK und kennt nur " +
        "das initialize-Verfahren. Umstieg auf das v2-SDK prüfen."
    );
  } else {
    console.error(`MCP-Protokoll: ${shown} (initialize-Verfahren).`);
  }
}

async function serveHttp(port: number): Promise<void> {
  const host = process.env["MCP_HTTP_HOST"] ?? "127.0.0.1";
  // Browser-Herkünfte, die mit diesem Server sprechen dürfen. Voreingestellt
  // leer: MCP-Clients sind keine Browser und schicken überhaupt keinen Origin,
  // die strenge Vorgabe kostet also nichts und schließt das Loch für
  // DNS-Rebinding, das die Spezifikation zu schließen verlangt. Ein Web-Client
  // lässt sich über MCP_HTTP_ALLOWED_ORIGINS ausdrücklich zulassen.
  const allowedOrigins = (process.env["MCP_HTTP_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");

  Bun.serve({
    port,
    hostname: host,
    idleTimeout: 120,
    // Bun nimmt sonst bis zu 128 MB je Rumpf an. Die größte legitime Anfrage
    // dieses Servers ist ein Werkzeugaufruf mit einer Bibelstelle, also einige
    // hundert Byte; 1 MB lässt jeden davon durch und nimmt einem anonymen
    // Aufrufer die Möglichkeit, Speicher über den JSON-Parser zu binden.
    maxRequestBodySize: 1024 * 1024,
    // Ohne das richtet sich der Modus nach NODE_ENV, und im Entwicklungsmodus
    // liefert Bun bei einer ungefangenen Ausnahme einen Stacktrace an den
    // Aufrufer aus. Heute fängt der SDK-Transport alle geprüften Fehlerpfade
    // sauber ab; die Zeile sorgt dafür, dass ein künftiges `throw` im Handler
    // nicht zum Informationsleck wird.
    development: false,
    async fetch(request) {
      const url = new URL(request.url);

      // Spezifikation: Server MÜSSEN den Origin prüfen, und zwar „on all
      // incoming connections". Die eigene Option des SDK dafür gilt als
      // überholt, zugunsten genau dieser Art äußerer Prüfung.
      //
      // Sie steht vor allem anderen, seit dem 03.08.2026. Vorher lag sie hinter
      // `/health` und hinter der Pfadprüfung, und damit war sie für `/health`
      // gar nicht wirksam: Eine beliebige Webseite konnte per JavaScript
      // erfahren, dass auf einem lokalen Port dieser Server läuft, und seinen
      // Zustand auslesen, den Grund einer Störung eingeschlossen. Genau das
      // Muster, gegen das die Prüfung in der Spezifikation steht.
      //
      // Am öffentlichen Endpunkt schützt sie wenig: Der ist absichtlich
      // authlos, es gibt kein Geheimnis zu erraten und keine Anmeldung, die
      // eine fremde Seite missbrauchen könnte. Ihr Wert liegt beim lokalen
      // Betrieb, den MCP_HTTP_PORT jederzeit erlaubt, und dort war ausgerechnet
      // der Pfad ungeschützt, den ein Fremder zuerst probiert.
      const origin = request.headers.get("origin");
      if (origin !== null && !allowedOrigins.includes(origin)) {
        // Kein `access-control-allow-methods`: Diese Antwort gehört zu keinem
        // Pfad, für den eine Methodenliste gälte, und einem abgewiesenen
        // Aufrufer ist über den Endpunkt nichts mitzuteilen.
        return withCors(new Response("Forbidden origin", { status: 403 }), null);
      }

      if (url.pathname === "/health") {
        // Meldet, ob der Dienst funktioniert, und nicht bloß, dass der Prozess
        // läuft. An einem HTTP-Endpunkt sieht kein Terminal auf stderr, und ohne
        // bible_setup gibt es keinen Weg mehr innerhalb des Protokolls, eine
        // kaputte Datenbank zu bemerken: Jedes Werkzeug wiese einfach ab, eines
        // nach dem anderen. 503 statt 200, damit eine Überwachung es sieht, ohne
        // den Rumpf zu zerlegen.
        if (request.method === "OPTIONS") {
          return withCors(new Response(null, { status: 204 }), METHODS_HEALTH);
        }
        // HEAD gehört dazu: Eine Überwachung, die nur den Status will, darf den
        // Rumpf sparen. Alles andere ist auf einer Zustandsauskunft sinnlos und
        // wurde bis zum 03.08.2026 trotzdem mit 200 beantwortet, ein DELETE
        // eingeschlossen.
        if (request.method !== "GET" && request.method !== "HEAD") {
          return withCors(
            new Response(null, { status: 405, headers: { allow: METHODS_HEALTH } }),
            METHODS_HEALTH
          );
        }
        const problem = healthProblem();
        return withCors(
          new Response(
            JSON.stringify(problem === null ? { status: "ok" } : { status: "fehler", grund: problem }),
            {
              status: problem === null ? 200 : 503,
              headers: { "content-type": "application/json" },
            }
          ),
          METHODS_HEALTH
        );
      }

      if (url.pathname !== "/mcp") {
        return withCors(new Response("Not found", { status: 404 }), null);
      }

      // Die Vorabanfrage steht hinter der Pfadprüfung, damit sie nur für einen
      // Pfad zusagt, den es gibt. Davor beantwortete sie jede Adresse mit 204
      // und einer Methodenliste, auch eine, die anschließend 404 lieferte.
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }), METHODS_MCP);
      }

      // Eine Weiche für alle Methoden, nicht nur für GET.
      //
      // Bis zum 03.08.2026 fing dieser Handler allein GET ab und überließ den
      // Rest dem Transport. Das ergab auf ein und demselben Pfad drei
      // Auskünfte: `GET` bekam `Allow: POST, OPTIONS`, `HEAD`, `PUT` und
      // `PATCH` bekamen vom SDK `Allow: GET, POST, DELETE`, und `DELETE`
      // bekam 200, weil `validateSession` im zustandslosen Betrieb nichts zu
      // prüfen hat. `withCors` überschreibt nur die `access-control`-Felder,
      // der fremde `Allow` blieb also stehen. Wer bloß die Vorabanfrage
      // richtiggestellt hätte, hätte eine Falschaussage gegen die nächste
      // getauscht.
      //
      // `DELETE` antwortet deshalb seit dem 03.08.2026 mit 405 statt 200. Die
      // Spezifikation erlaubt das an dieser Stelle ausdrücklich (MAY), und ein
      // Server ohne Sitzung hat nichts zu beenden. Die frühere Entscheidung,
      // es beim 200 des SDK zu belassen, stand unter der Annahme, dass keine
      // Kopfzeile etwas anderes behauptet; mit einer Methodenliste je Pfad
      // gilt die nicht mehr.
      //
      // GET wird beantwortet, aber nicht offengehalten.
      //
      // Der GET-Kanal dient server-initiierten Nachrichten. Dieser Server sendet
      // keine: er ist zustandslos, schiebt nichts und hat nichts fortzusetzen.
      // Ohne diesen Zweig lief ein GET trotzdem durch den Transport und blieb als
      // SSE-Stream offen, der nie ein Byte liefert: gemessen 120 Sekunden je
      // Verbindung (Bun `idleTimeout`), 30 parallele GETs hielten 30
      // Dateideskriptoren samt je einer Serverinstanz. Für einen anonymen
      // Endpunkt ist das ein kostenloser Verbindungshalter, und eine
      // Ratenbegrenzung davor greift bei offenen Verbindungen schlecht.
      //
      // Warum 405 und nicht 200: Die Spezifikation lässt auf diesen GET genau
      // zwei Antworten zu, `text/event-stream` oder 405. Eine 200 mit leerem
      // Rumpf ist keine davon, und der Aufrufer kann sie nur als eröffneten
      // Strom lesen. Im SDK-Client ist `response.ok` dann wahr, er geht in
      // `_handleSseStream`, der Rumpf endet sofort, und die Wiederverbindung
      // greift mit `initialReconnectionDelay: 1000`. `maxRetries: 2` fängt das
      // nicht: Der Zähler gilt gescheiterten Verbindungen, eine 200 gilt als
      // geglückt und setzt ihn zurück. Das Ergebnis ist eine Schleife ohne Ende,
      // im Sekundentakt.
      //
      // Gemessen am 03.08.2026 am laufenden Dienst: 41 430 GET gegen 389 POST
      // binnen 24 Stunden, 0,93 Anfragen je Sekunde durchgehend (1000 ms Takt
      // plus Umlaufzeit), rund 40 000 Anfragen am Tag ohne jede Nutzlast. Die
      // mittlere Antwort war mit 797 Byte kleiner als ein einzelner Vers, es
      // wurde also nichts abgerufen. Auf 405 kehrt derselbe Client wortlos
      // zurück ("This is an expected case that should not trigger an error") und
      // arbeitet mit POST weiter.
      //
      // Die frühere Begründung, 200 sei an den einzigen nachweislich
      // funktionierenden fremden Connector angeglichen, stützte sich auf eine
      // Beobachtung an fremdem Gerät (n=1) und nicht darauf, dass claude.ai die
      // 200 braucht; die Fehlersuche-Anleitung von Claude nennt 405 beim
      // Erreichbarkeitstest ausdrücklich als unbedenklich.
      //
      // `Allow` gehört zwingend dazu, RFC 9110 verlangt es bei 405, und es ist
      // die eigentliche Auskunft: nur POST, absichtlich so.
      if (request.method !== "POST") {
        return withCors(
          new Response(null, { status: 405, headers: { allow: METHODS_MCP } }),
          METHODS_MCP
        );
      }

      // Hält die Protokollrevision des Aufrufers fest, höchstens eine Zeile je
      // gesehener Version. Lässt die Anfrage nie scheitern: Ein Aufrufer darf ein
      // Nachschlagen nicht dadurch zerbrechen können, dass er einen Rumpf
      // schickt, den dies hier nicht lesen kann.
      await noteProtocolVersion(request);

      // Zustandslos: ein Server samt Transport je Anfrage, keine
      // Sitzungsregistratur. Dieser Server ist reines Anfrage-Antwort-Spiel, er
      // schiebt keine Benachrichtigungen und hat nichts fortzusetzen; Sitzungen
      // brächten ihm also nichts und kosteten eine Registratur, die zu räumen, zu
      // deckeln und verfallen zu lassen wäre. Eine frühere sitzungsbehaftete
      // Fassung lief genau dort aus (21 Anfragen, 21 Sitzungen, die nie
      // verschwanden, gemessen 25.07.2026). Beide Objekte fallen aus dem
      // Geltungsbereich, sobald der Antwortstrom endet.
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await createServer().connect(transport);
      return withCors(await transport.handleRequest(request), METHODS_MCP);
    },
  });

  console.error(`Bibelstudium MCP server running on http://${host}:${port}/mcp`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(
      `WARNUNG: gebunden an ${host}, also nicht nur lokal erreichbar. ` +
        "Ohne vorgelagertes TLS und Zugriffsschutz nicht ins offene Netz stellen."
    );
  }
}

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
    await serveHttp(port);
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
