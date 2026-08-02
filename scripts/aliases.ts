/**
 * Aliase für die deutschen Namen der biblischen Bücher.
 *
 * Bildet gängige deutsche Buchnamen, Abkürzungen und Schreibvarianten auf die
 * bolls.life-Buchnummern (1 bis 66) ab: volle Namen, übliche Abkürzungen und
 * umgangssprachliche Formen.
 */

export const BOOK_ALIASES: ReadonlyArray<readonly [alias: string, bookId: number]> = [
  // 1. Genesis / 1. Mose
  ["1. mose", 1], ["1.mose", 1], ["1 mose", 1],
  ["genesis", 1], ["gen", 1], ["1mo", 1], ["1. mo", 1],

  // 2. Exodus / 2. Mose
  ["2. mose", 2], ["2.mose", 2], ["2 mose", 2],
  ["exodus", 2], ["ex", 2], ["2mo", 2], ["2. mo", 2],

  // 3. Levitikus / 3. Mose
  ["3. mose", 3], ["3.mose", 3], ["3 mose", 3],
  ["levitikus", 3], ["leviticus", 3], ["lev", 3], ["3mo", 3], ["3. mo", 3],

  // 4. Numeri / 4. Mose
  ["4. mose", 4], ["4.mose", 4], ["4 mose", 4],
  ["numeri", 4], ["num", 4], ["4mo", 4], ["4. mo", 4],

  // 5. Deuteronomium / 5. Mose
  ["5. mose", 5], ["5.mose", 5], ["5 mose", 5],
  ["deuteronomium", 5], ["dtn", 5], ["deut", 5], ["5mo", 5], ["5. mo", 5],

  // 6. Josua
  ["josua", 6], ["jos", 6],

  // 7. Richter
  ["richter", 7], ["ri", 7], ["richt", 7],

  // 8. Ruth
  ["ruth", 8], ["rut", 8], ["rt", 8],

  // 9. 1. Samuel
  ["1. samuel", 9], ["1.samuel", 9], ["1 samuel", 9],
  ["1sam", 9], ["1. sam", 9], ["1 sam", 9],

  // 10. 2. Samuel
  ["2. samuel", 10], ["2.samuel", 10], ["2 samuel", 10],
  ["2sam", 10], ["2. sam", 10], ["2 sam", 10],

  // 11. 1. Könige
  ["1. könige", 11], ["1.könige", 11], ["1 könige", 11],
  ["1. koenige", 11], ["1 koenige", 11],
  ["1kön", 11], ["1. kön", 11], ["1 kön", 11],
  ["1. kon", 11], ["1kon", 11],

  // 12. 2. Könige
  ["2. könige", 12], ["2.könige", 12], ["2 könige", 12],
  ["2. koenige", 12], ["2 koenige", 12],
  ["2kön", 12], ["2. kön", 12], ["2 kön", 12],
  ["2. kon", 12], ["2kon", 12],

  // 13. 1. Chronik
  ["1. chronik", 13], ["1.chronik", 13], ["1 chronik", 13],
  ["1chr", 13], ["1. chr", 13], ["1 chr", 13],

  // 14. 2. Chronik
  ["2. chronik", 14], ["2.chronik", 14], ["2 chronik", 14],
  ["2chr", 14], ["2. chr", 14], ["2 chr", 14],

  // 15. Esra
  ["esra", 15], ["esr", 15],

  // 16. Nehemia
  ["nehemia", 16], ["neh", 16],

  // 17. Esther
  ["esther", 17], ["est", 17],

  // 18. Hiob / Job
  ["hiob", 18], ["hi", 18], ["job", 18],

  // 19. Psalmen
  ["psalm", 19], ["psalmen", 19], ["ps", 19], ["psa", 19],

  // 20. Sprüche / Sprichwörter
  ["sprüche", 20], ["sprueche", 20], ["spr", 20],
  ["sprichwörter", 20], ["sprichwoerter", 20],

  // 21. Prediger / Kohelet
  ["prediger", 21], ["pred", 21], ["kohelet", 21], ["koh", 21],

  // 22. Hohelied
  ["hohelied", 22], ["hld", 22], ["hl", 22], ["hoheslied", 22],

  // 23. Jesaja
  ["jesaja", 23], ["jes", 23], ["isa", 23],

  // 24. Jeremia
  ["jeremia", 24], ["jer", 24],

  // 25. Klagelieder
  ["klagelieder", 25], ["klgl", 25], ["kla", 25],

  // 26. Hesekiel / Ezechiel
  ["hesekiel", 26], ["hes", 26], ["ezechiel", 26], ["ez", 26], ["hsk", 26],

  // 27. Daniel
  ["daniel", 27], ["dan", 27],

  // 28. Hosea
  ["hosea", 28], ["hos", 28],

  // 29. Joel
  ["joel", 29],

  // 30. Amos
  ["amos", 30], ["am", 30],

  // 31. Obadja
  ["obadja", 31], ["obd", 31], ["ob", 31],

  // 32. Jona
  ["jona", 32], ["jon", 32],

  // 33. Micha
  ["micha", 33], ["mi", 33],

  // 34. Nahum
  ["nahum", 34], ["nah", 34], ["na", 34],

  // 35. Habakuk
  ["habakuk", 35], ["hab", 35],

  // 36. Zephanja
  ["zephanja", 36], ["zef", 36], ["zeph", 36],

  // 37. Haggai
  ["haggai", 37], ["hag", 37],

  // 38. Sacharja
  ["sacharja", 38], ["sach", 38], ["sac", 38],

  // 39. Maleachi
  ["maleachi", 39], ["mal", 39],

  // 40. Matthäus
  ["matthäus", 40], ["matthaeus", 40], ["matt", 40], ["mt", 40], ["mat", 40],

  // 41. Markus
  ["markus", 41], ["mk", 41], ["mar", 41],

  // 42. Lukas
  ["lukas", 42], ["lk", 42], ["luk", 42],

  // 43. Johannes (Evangelium)
  ["johannes", 43], ["joh", 43], ["jn", 43],

  // 44. Apostelgeschichte
  ["apostelgeschichte", 44], ["apg", 44],

  // 45. Römer
  ["römer", 45], ["roemer", 45], ["röm", 45], ["rom", 45],

  // 46. 1. Korinther
  ["1. korinther", 46], ["1.korinther", 46], ["1 korinther", 46],
  ["1kor", 46], ["1. kor", 46], ["1 kor", 46],

  // 47. 2. Korinther
  ["2. korinther", 47], ["2.korinther", 47], ["2 korinther", 47],
  ["2kor", 47], ["2. kor", 47], ["2 kor", 47],

  // 48. Galater
  ["galater", 48], ["gal", 48],

  // 49. Epheser
  ["epheser", 49], ["eph", 49],

  // 50. Philipper
  ["philipper", 50], ["phil", 50],

  // 51. Kolosser
  ["kolosser", 51], ["kol", 51],

  // 52. 1. Thessalonicher
  ["1. thessalonicher", 52], ["1.thessalonicher", 52], ["1 thessalonicher", 52],
  ["1thess", 52], ["1. thess", 52], ["1 thess", 52], ["1th", 52],

  // 53. 2. Thessalonicher
  ["2. thessalonicher", 53], ["2.thessalonicher", 53], ["2 thessalonicher", 53],
  ["2thess", 53], ["2. thess", 53], ["2 thess", 53], ["2th", 53],

  // 54. 1. Timotheus
  ["1. timotheus", 54], ["1.timotheus", 54], ["1 timotheus", 54],
  ["1tim", 54], ["1. tim", 54], ["1 tim", 54],

  // 55. 2. Timotheus
  ["2. timotheus", 55], ["2.timotheus", 55], ["2 timotheus", 55],
  ["2tim", 55], ["2. tim", 55], ["2 tim", 55],

  // 56. Titus
  ["titus", 56], ["tit", 56],

  // 57. Philemon
  ["philemon", 57], ["phlm", 57], ["phm", 57],

  // 58. Hebräer
  ["hebräer", 58], ["hebraeer", 58], ["heb", 58], ["hebr", 58],

  // 59. Jakobus
  ["jakobus", 59], ["jak", 59],

  // 60. 1. Petrus
  ["1. petrus", 60], ["1.petrus", 60], ["1 petrus", 60],
  ["1petr", 60], ["1. petr", 60], ["1 petr", 60], ["1pt", 60],

  // 61. 2. Petrus
  ["2. petrus", 61], ["2.petrus", 61], ["2 petrus", 61],
  ["2petr", 61], ["2. petr", 61], ["2 petr", 61], ["2pt", 61],

  // 62. 1. Johannes
  ["1. johannes", 62], ["1.johannes", 62], ["1 johannes", 62],
  ["1joh", 62], ["1. joh", 62], ["1 joh", 62], ["1jn", 62],

  // 63. 2. Johannes
  ["2. johannes", 63], ["2.johannes", 63], ["2 johannes", 63],
  ["2joh", 63], ["2. joh", 63], ["2 joh", 63], ["2jn", 63],

  // 64. 3. Johannes
  ["3. johannes", 64], ["3.johannes", 64], ["3 johannes", 64],
  ["3joh", 64], ["3. joh", 64], ["3 joh", 64], ["3jn", 64],

  // 65. Judas
  ["judas", 65], ["jud", 65],

  // 66. Offenbarung
  ["offenbarung", 66], ["offb", 66], ["off", 66], ["apokalypse", 66],
];

/** Baut aus der Aliasliste eine Map für den Zugriff in O(1). */
export function buildAliasMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const [alias, bookId] of BOOK_ALIASES) {
    map.set(alias, bookId);
  }
  return map;
}
