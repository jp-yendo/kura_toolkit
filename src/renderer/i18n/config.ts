import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import jaTranslations from './locales/ja';
import enTranslations from './locales/en';

i18n.use(initReactI18next).init({
    resources: {
        ja: { translation: jaTranslations },
        en: { translation: enTranslations },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false,
    },
});

export default i18n;
