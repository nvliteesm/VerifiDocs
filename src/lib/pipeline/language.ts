// Which language a short piece of student text is written in: English, Bahasa Indonesia, or not clear.
//
// It is used to tell the model, in so many words, which language to write its explanation in. A small model given
// only "answer in the language of the claim" sometimes answers in English to an Indonesian claim. Naming the
// language ("write the reason in Indonesian") is far more reliable than leaving the model to work it out.
//
// It counts very common function words of each language. It is not a general language detector: it only has to
// tell these two apart on a sentence or two, and say "unknown" when it cannot, so the prompt falls back to the
// general instruction.
export type TextLanguage = "en" | "id" | "unknown";

const INDONESIAN = new Set([
  "yang", "dan", "di", "ke", "dari", "pada", "untuk", "dengan", "adalah", "ini", "itu", "dalam", "tidak", "juga",
  "oleh", "atau", "sebagai", "karena", "setelah", "bagi", "telah", "akan", "dapat", "lebih", "serta", "antara",
  "hingga", "bahwa", "mereka", "semua", "seluruh", "setiap", "terhadap", "sudah", "belum", "masih", "sama",
]);

const ENGLISH = new Set([
  "the", "of", "and", "to", "in", "is", "that", "for", "was", "were", "by", "with", "on", "as", "at", "from",
  "are", "this", "which", "it", "be", "an", "has", "have", "had", "not", "or", "but", "after", "during",
  "than", "their", "its", "all", "every", "more",
]);

export function detectLanguage(text: string): TextLanguage {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let indonesian = 0;
  let english = 0;
  for (const word of words) {
    if (INDONESIAN.has(word)) indonesian += 1;
    if (ENGLISH.has(word)) english += 1;
  }
  if (indonesian > english) return "id";
  if (english > indonesian) return "en";
  return "unknown";
}

/** The model's instruction for the language of a short explanation about `claimText`. */
export function explanationLanguage(claimText: string): string {
  switch (detectLanguage(claimText)) {
    case "id":
      return "written in Indonesian (Bahasa Indonesia), the language of the claim";
    case "en":
      return "written in English, the language of the claim";
    default:
      return "in the same language as the claim";
  }
}
