/**
 * Text people type or receive (names, cities, pot and payee names) is shown
 * only as text, never as HTML. On top of that, characters that don't show
 * but change what is shown are taken out: control characters and invisible
 * formatting, which includes right-to-left overrides (that make "Idara" read
 * as another name) and zero-width characters (that make two different names
 * look the same).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

export function hasInvisible(text: string): boolean {
  return new RegExp(INVISIBLE.source, "u").test(text);
}
