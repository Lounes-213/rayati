import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/data/storage';
import { DICTS, LANGS, createI18n, detectLang } from '../src/services/i18n';

describe('i18n', () => {
  it('ships the three languages with identical keys', () => {
    const reference = Object.keys(DICTS.ar).sort();
    for (const lang of LANGS) {
      expect(Object.keys(DICTS[lang]).sort()).toEqual(reference);
    }
    expect(reference.length).toBeGreaterThan(50);
  });

  it('translates and substitutes variables', () => {
    const i18n = createI18n({ storage: createMemoryStorage(), initial: 'ar' });
    expect(i18n.t('welcome.join')).toBe(DICTS.ar['welcome.join']);
    expect(i18n.t('seat.selected', { section: 'B', row: 12, seat: 7 })).toContain('B');
    expect(i18n.t('seat.selected', { section: 'B', row: 12, seat: 7 })).toContain('12');
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
  });

  it('switches language, direction and storage in one tap', () => {
    const storage = createMemoryStorage();
    const i18n = createI18n({ storage, initial: 'ar' });
    const seen: string[] = [];
    i18n.onChange((lang) => seen.push(lang));
    expect(i18n.dir()).toBe('rtl');
    i18n.setLang('fr');
    expect(i18n.lang()).toBe('fr');
    expect(i18n.dir()).toBe('ltr');
    expect(i18n.t('welcome.join')).toBe(DICTS.fr['welcome.join']);
    expect(seen).toEqual(['fr']);
    expect(storage.get('lang.v1')).toBe('fr');
  });

  it('detects the language from the link, then the saved choice, then the browser', () => {
    const storage = createMemoryStorage();
    expect(detectLang({ storage, search: '?lang=en', navigatorLanguage: 'ar-DZ' })).toBe('en');
    storage.set('lang.v1', 'fr');
    expect(detectLang({ storage, search: '', navigatorLanguage: 'en-US' })).toBe('fr');
    const fresh = createMemoryStorage();
    expect(detectLang({ storage: fresh, search: '', navigatorLanguage: 'en-GB' })).toBe('en');
    expect(detectLang({ storage: fresh, search: '', navigatorLanguage: 'ar-DZ' })).toBe('ar');
    expect(detectLang({ storage: fresh, search: '', navigatorLanguage: 'es-ES' })).toBe('ar');
  });
});
