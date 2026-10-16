import './ui/styles/base.css';

const btns = document.querySelectorAll<HTMLButtonElement>('.lang__btn');

function setLang(lang: string): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false'));
  document.querySelectorAll('.ar-text').forEach((el) => el.classList.toggle('hidden', lang !== 'ar'));
  document.querySelectorAll('.fr-text').forEach((el) => el.classList.toggle('hidden', lang !== 'fr'));
  document.querySelectorAll('.en-text').forEach((el) => el.classList.toggle('hidden', lang !== 'en'));
  localStorage.setItem('rayati_lang', lang);
}

btns.forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.lang) setLang(b.dataset.lang);
}));

const saved = localStorage.getItem('rayati_lang') || 'ar';
setLang(saved);
