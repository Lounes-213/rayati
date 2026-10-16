/**
 * i18n service. Dictionaries are bundled (about 12 KB of JSON before gzip) so a
 * one-tap language switch works completely offline.
 */
import ar from '../i18n/ar.json';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { KEYS } from '../core/config';
import type { Lang } from '../core/types';
import { createStorage, type KVStorage } from '../data/storage';

export type Dict = Record<string, string>;

export const LANGS: Lang[] = ['ar', 'fr', 'en'];
export const DICTS: Record<Lang, Dict> = {
  ar: ar as Dict,
  fr: fr as Dict,
  en: en as Dict,
};

export const LANG_LABELS: Record<Lang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };
export const LANG_LOCALES: Record<Lang, string> = { ar: 'ar-DZ', fr: 'fr-DZ', en: 'en-GB' };

export interface I18n {
  lang(): Lang;
  dir(): 'rtl' | 'ltr';
  locale(): string;
  t(key: string, vars?: Record<string, string | number>): string;
  setLang(lang: Lang): void;
  /** Applies lang/dir on <html> and returns the dictionary. */
  apply(): void;
  onChange(cb: (lang: Lang) => void): () => void;
  formatNumber(value: number): string;
}

export interface I18nOptions {
  storage?: KVStorage;
  initial?: Lang;
  search?: string;
  navigatorLanguage?: string;
}

/** ?lang= > saved choice > browser language > Arabic (Arabic-first product). */
export function detectLang(options: I18nOptions = {}): Lang {
  const params = new URLSearchParams(options.search ?? (typeof location !== 'undefined' ? location.search : ''));
  const fromQuery = params.get('lang') as Lang | null;
  if (fromQuery && LANGS.includes(fromQuery)) return fromQuery;
  const storage = options.storage ?? createStorage();
  const saved = storage.get(KEYS.lang) as Lang | null;
  if (saved && LANGS.includes(saved)) return saved;
  const nav = options.navigatorLanguage ?? (typeof navigator !== 'undefined' ? navigator.language : 'ar');
  const lower = (nav || 'ar').toLowerCase();
  if (lower.startsWith('fr')) return 'fr';
  if (lower.startsWith('en')) return 'en';
  return 'ar';
}

export function createI18n(options: I18nOptions = {}): I18n {
  const storage = options.storage ?? createStorage();
  const listeners = new Set<(lang: Lang) => void>();
  let current: Lang = options.initial ?? detectLang(options);

  function dict(lang: Lang): Dict {
    return DICTS[lang] ?? DICTS.ar;
  }

  const api: I18n = {
    lang: () => current,
    dir: () => (current === 'ar' ? 'rtl' : 'ltr'),
    locale: () => LANG_LOCALES[current],

    t(key, vars) {
      const raw = dict(current)[key] ?? DICTS.en[key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
        vars[name] === undefined ? match : String(vars[name]),
      );
    },

    setLang(lang) {
      if (!LANGS.includes(lang) || lang === current) return;
      current = lang;
      storage.set(KEYS.lang, lang);
      api.apply();
      listeners.forEach((cb) => cb(lang));
    },

    apply() {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      root.lang = current;
      root.dir = api.dir();
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    formatNumber(value) {
      try {
        return new Intl.NumberFormat(LANG_LOCALES[current]).format(value);
      } catch {
        return String(value);
      }
    },
  };

  return api;
}
