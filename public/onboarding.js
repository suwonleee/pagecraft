import { language } from './i18n.js';
import koreanSample from '../fixtures/ko/welcome.html';
import chineseSample from '../fixtures/zh-CN/welcome.html';
import japaneseSample from '../fixtures/ja/welcome.html';
import sampleHtml from '../fixtures/welcome.html';

// Included in the browser bundle: samples need neither a server nor an extra offline asset.
export function initOnboarding({ importFile, chooseCopy }) {
  document.querySelector('#try-sample').addEventListener('click', () => {
    void importFile(new File([({ en: sampleHtml, ko: koreanSample, 'zh-CN': chineseSample, ja: japaneseSample })[language]], 'Pagecraft-sample.html', { type: 'text/html' }));
  });
  document.querySelector('#welcome-import').addEventListener('click', chooseCopy);
}
