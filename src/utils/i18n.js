import dictionaries from '../data/menuTranslations.json';

export const DEFAULT_LANGUAGE = 'es';
let currentLanguage = DEFAULT_LANGUAGE;

function resolveKey(dict, key) {
  if (!dict || !key) return undefined;
  return key.split('.').reduce((acc, part) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, part)) {
      return acc[part];
    }
    return undefined;
  }, dict);
}

function format(template, replacements = {}) {
  if (typeof template !== 'string') return template;
  return Object.entries(replacements).reduce(
    (acc, [placeholder, value]) => acc.replaceAll(`{{${placeholder}}}`, String(value)),
    template
  );
}

export function setLanguage(lang) {
  const nextLang = dictionaries[lang] ? lang : DEFAULT_LANGUAGE;
  currentLanguage = nextLang;
  if (typeof window !== 'undefined') {
    window.__CV_LANG__ = nextLang;
  }
  return currentLanguage;
}

export function getLanguage() {
  if (typeof window !== 'undefined' && window.__CV_LANG__) {
    currentLanguage = window.__CV_LANG__;
  }
  return currentLanguage;
}

export function translate(key, replacements = {}, langOverride) {
  const lang = langOverride || getLanguage();
  const primaryDict = dictionaries[lang] || dictionaries[DEFAULT_LANGUAGE] || {};
  let template = resolveKey(primaryDict, key);
  if (template === undefined) {
    const fallbackDict = dictionaries[DEFAULT_LANGUAGE] || {};
    template = resolveKey(fallbackDict, key);
  }
  if (template === undefined) return key;
  if (typeof template === 'string') {
    return format(template, replacements);
  }
  return template;
}

export function getDictionary(lang = getLanguage()) {
  return dictionaries[lang] || dictionaries[DEFAULT_LANGUAGE] || {};
}

export function getAvailableLanguages() {
  return Object.keys(dictionaries);
}

export default {
  DEFAULT_LANGUAGE,
  getAvailableLanguages,
  getDictionary,
  getLanguage,
  setLanguage,
  translate,
};