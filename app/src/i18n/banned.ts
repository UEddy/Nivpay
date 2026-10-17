/**
 * Product rule: NivPay reads like a fintech app, and people never need to know
 * it runs on crypto. Whole words, plurals included. "MON" counts only in
 * capitals, so "Mon 14 Dec" stays allowed.
 */
export const BANNED: [string, RegExp][] = [
  ["crypto", /\bcryptos?\b/i],
  ["blockchain", /\bblockchains?\b/i],
  ["block", /\bblocks?\b/i],
  ["chain", /\bchains?\b/i],
  ["onchain", /\bonchains?\b/i],
  ["wallet", /\bwallets?\b/i],
  ["token", /\btokens?\b/i],
  ["gas", /\bgas(es)?\b/i],
  ["Monad", /\bmonads?\b/i],
  ["testnet", /\btestnets?\b/i],
  ["network", /\bnetworks?\b/i],
  ["address", /\baddress(es)?\b/i],
  ["hash", /\bhash(es)?\b/i],
  ["contract", /\bcontracts?\b/i],
  ["stablecoin", /\bstablecoins?\b/i],
  ["seed", /\bseeds?\b/i],
  ["mnemonic", /\bmnemonics?\b/i],
  ["private key", /\bprivate\s+keys?\b/i],
  ["0x", /\b0x/i],
  ["MON", /\bMONs?\b/],
  // Agora's settlement is described as sending in another currency, with a
  // one-time setup. Never in its own technical terms.
  ["swap", /\bswap(s|ped|ping)?\b/i],
  ["approve", /\bapprov(e|es|ed|al|als|ing)\b/i],
  ["whitelist", /\b(white|allow)list(s|ed|ing)?\b/i],
  // The contract counts money in a pot as shares. On screen it's "your part".
  ["shares", /\bshares\b/i],
  // Typography rule, not a crypto word: no em or en dashes anywhere.
  ["em dash", /\u2014/],
  ["en dash", /\u2013/],
];

export function bannedIn(text: string): string[] {
  return BANNED.filter(([, re]) => re.test(text)).map(([word]) => word);
}

/**
 * Each language's own words for the same things, on top of the English list,
 * which applies to every language too ("Monad", "MON", "0x" and "token" are
 * banned everywhere). Whole words, plurals included, any letter case.
 */
const word = (w: string) => new RegExp(`(?<![\\p{L}])(?:${w})(?![\\p{L}])`, "iu");
export const BANNED_BY_LANG: Record<string, [string, RegExp][]> = {
  fr: [
    ["portefeuille", word("portefeuilles?")],
    ["chaîne", word("cha[iî]nes?")],
    ["bloc", word("blocs?")],
    ["jeton", word("jetons?")],
    ["contrat", word("contrats?")],
    ["adresse", word("adresses?")],
    ["réseau", word("r[ée]seaux?")],
    ["gaz", word("gaz")],
    ["approuver", word("approuv\\p{L}*|approbations?")],
    ["crypto", word("crypto\\p{L}*")],
  ],
  es: [
    ["cartera", word("carteras?|billeteras?")],
    ["cadena", word("cadenas?")],
    ["bloque", word("bloques?")],
    ["ficha", word("fichas?")],
    ["contrato", word("contratos?")],
    ["dirección", word("direcci[oó]n|direcciones")],
    ["red", word("red|redes")],
    ["aprobar", word("aprob\\p{L}*")],
    ["cripto", word("cripto\\p{L}*")],
  ],
  pt: [
    ["carteira", word("carteiras?")],
    ["cadeia", word("cadeias?")],
    ["bloco", word("blocos?")],
    ["contrato", word("contratos?")],
    ["endereço", word("endere[cç]os?")],
    ["rede", word("redes?")],
    ["gás", word("g[aá]s")],
    ["aprovar", word("aprov\\p{L}*")],
    ["cripto", word("cripto\\p{L}*")],
  ],
};

/** Banned words in a text, by the English list and the language's own. */
export function bannedInLang(text: string, lang: string): string[] {
  return [...BANNED, ...(BANNED_BY_LANG[lang] ?? [])].filter(([, re]) => re.test(text)).map(([w]) => w);
}
