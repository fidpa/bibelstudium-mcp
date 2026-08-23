/**
 * Fehlermeldungen, die mehr als ein Werkzeug wortgleich ausgibt.
 *
 * Sie stehen hier und nicht bei den Zusicherungen, weil sie im Server ebenfalls
 * an einer Stelle stehen (`chapterOutOfRange`, `verseOutOfRange`, `bookTooLong`
 * in `werkzeug-helfer.ts`). Eine Grenze, deren Meldung an fünf Orten hingeschrieben
 * wurde, hat hier schon einmal auseinandergelebt: Drei Werkzeuge wiesen
 * `verse=999` mit „must be a positive integer" ab, einer Bedingung, die die
 * Eingabe erfüllte.
 *
 * Der Wortlaut steht also einmal da, die Zusicherung darüber aber bei ihrem
 * Werkzeug.
 *
 * **Die Zahlen stehen hier absichtlich als Literal und werden nicht aus
 * `werkzeug-helfer.ts` importiert.** Das ist kein Versehen und keine
 * Doppelpflege, sondern der Zweck dieser Datei: Im Produktivcode gibt es keine
 * zweite Textkopie mehr, weil auch die Ressourcen-Segmentprüfer in `server.ts`
 * dieselben Konstanten importieren. Diese Datei hält damit die einzige
 * unabhängige Fassung. Würde sie die Konstante einsetzen, prüfte die Zusicherung
 * nur noch, *welche* Meldung gewählt wurde, nicht mehr, *wie sie lautet*, und
 * eine verschobene Grenze liefe stillschweigend durch die Suite. Die Eingabewerte
 * in den Bündeln sind der umgekehrte Fall: Sie kommen seit dem 23.08.2026 aus den
 * Konstanten, damit ein Grenzfall die Grenze prüft und nicht die Zahl 150.
 *
 * Praktisch heißt das: Wer eine Grenze anhebt, macht diese Datei rot. Das ist
 * gewollt, denn diese Texte gehen an den Aufrufer und sind öffentliche
 * Schnittstelle.
 */

export const VERSE_AUSSERHALB = "Error: 'verse' must be an integer between 1 and 200";
export const KAPITEL_AUSSERHALB = "Error: 'chapter' must be an integer between 1 and 150";
/**
 * Die Grenze der Versliste. Sie wird an zwei Orten geprüft, und dass beide
 * denselben Wortlaut sehen, ist die Aussage der Zusicherung „Versliste
 * zeichengleich mit dem Werkzeug": Das Werkzeug meldet sie, die Ressource muss
 * sie zeichengleich wiederholen.
 */
export const VERSLISTE_ZU_LANG = "Error: 'verses' must list at most 30 comma-separated segments";

export const BUCH_ZU_LANG =
  "Error: 'book' must be at most 50 characters (e.g. 'Jesaja', '1. Mose', 'Römer')";

/**
 * Anwesenheit und Typ sind zwei Bedingungen. Vier Werkzeuge falteten sie und
 * antworteten auf `{"book": 123}` mit „'book' is required", obwohl das Feld
 * gesetzt war. Diese Meldung ist der Beleg für die Trennung, und sie steht hier,
 * weil alle vier sie wortgleich ausgeben; die „is required"-Meldung dagegen
 * trägt je Werkzeug eigene Beispiele und wird deshalb dort geprüft.
 */
export const BUCH_KEINE_ZEICHENKETTE = "Error: 'book' must be a string with the German book name";
