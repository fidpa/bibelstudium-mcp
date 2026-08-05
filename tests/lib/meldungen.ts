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
