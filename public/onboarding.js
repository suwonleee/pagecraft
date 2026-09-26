import { language } from './i18n.js';
import koreanSample from '../fixtures/ko/welcome.html';
import sampleHtml from '../fixtures/welcome.html';

// Included in the browser bundle: samples need neither a server nor an extra offline asset.
export function initOnboarding({ importFile, chooseCopy }) {
  document.querySelector('#try-sample').addEventListener('click', () => {
    void importFile(new File([language === 'ko' ? koreanSample : sampleHtml], 'Pagecraft-sample.html', { type: 'text/html' }));
  });
  document.querySelector('#welcome-import').addEventListener('click', chooseCopy);
}
