import { t, language } from './i18n.js';
// Templates and pasted HTML use the same import, validation, and save contract as files.
const templates = {
  weekly: { file: 'weekly-report.html', name: t("weekly-report.html") },
  decision: { file: 'decision-brief.html', name: t("decision-brief.html") },
};

export const reportPrompt = t("Create an HTML report that a person can edit in Pagecraft and a coding agent can continue editing.\n\nTopic: [report topic]\nAudience: [who will read it]\nPurpose and key question: [the decision to make]\nVerified material: [facts, metrics, sources, and dates]\n\nRequirements:\n- Output one complete UTF-8 HTML document. Embed CSS in <style>. Do not use external fonts, CDNs, scripts, iframes, or canvas.\n- Lead with the conclusion and summary. Separate evidence, risks, and next steps. Distinguish facts, assumptions, and unknowns. Do not invent metrics or sources.\n- Use semantic main, section, h1–h3, p, ul, and table elements. Give sections, editable text, and table cells meaningful unique IDs. Preserve those IDs in later edits.\n- Put editable text directly inside p, h1–h3, li, th, or td elements. Use separate paragraphs instead of nested spans or line breaks. Keep tables simple.\n- Use normal document flow and CSS Grid or Flex. Avoid fixed heights and absolute positioning that clip content. Keep the report readable at 390px.\n- Define A4 margins and page breaks with @media print and @page. Label table columns clearly and do not rely on color alone.\n- Do not add editor-specific attributes or libraries. If a human-edited HTML file is supplied, change only the requested parts and preserve unrelated text, styles, and IDs.\n\nOutput only HTML code.");

export function initReportStart({ importFile, browserMode }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#report-dialog');
  const status = $('#report-status');
  const source = $('#report-html');
  const filename = $('#report-filename');
  let request;
  let busy = false;
  const say = (message, error = false) => { status.textContent = message; status.dataset.error = String(error); };
  const setBusy = value => {
    busy = value;
    for (const button of dialog.querySelectorAll('[data-report-template],#import-report-html')) button.disabled = value;
    dialog.setAttribute('aria-busy', String(value));
  };
  const open = () => { if (!dialog.open) { say(''); dialog.showModal(); } };
  $('#new-report').addEventListener('click', open);
  $('#welcome-report').addEventListener('click', open);
  $('#close-report').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { request?.abort(); request = undefined; });
  $('#report-prompt').value = reportPrompt;
  $('#copy-report-prompt').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(reportPrompt);
      say(t("Writing request copied. Paste it into your AI tool and fill in the topic and evidence."));
    } catch {
      $('#prompt-details').open = true;
      $('#report-prompt').focus();
      $('#report-prompt').select();
      say(t("Automatic copying was blocked. Copy the selected request with ⌘/Ctrl+C."));
    }
  });
  const accept = async file => {
    dialog.close();
    const imported = await importFile(file, { created: true });
    if (imported) { source.value = ''; filename.value = 'report.html'; }
  };
  for (const button of dialog.querySelectorAll('[data-report-template]')) {
    button.addEventListener('click', async () => {
      if (busy) return;
      const template = templates[button.dataset.reportTemplate];
      if (!template) return;
      setBusy(true);
      say(t("Opening report template…"));
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(new URL(`./reports/${language === 'ko' ? 'ko/' : ''}${template.file}`, location.href), { signal: controller.signal });
        if (!response.ok) throw new Error(t("Could not read the report template. Try again."));
        const html = await response.text();
        if (controller.signal.aborted || !dialog.open) return;
        request = undefined;
        await accept(new File([html], template.name, { type: 'text/html' }));
      } catch (error) {
        if (dialog.open && request === controller) say(error.name === 'AbortError' ? t("The template request timed out. Try again or paste HTML.") : error.message, true);
      } finally { clearTimeout(timeout); if (request === controller) request = undefined; setBusy(false); }
    });
  }
  $('#import-report-html').addEventListener('click', async () => {
    if (busy) return;
    const limit = (browserMode ? 16 : 5) * 1024 * 1024;
    // Check before regex work or parsing. Never insert user markup in the app DOM.
    if (source.value.length > limit || new Blob([source.value]).size > limit) { say(t`Paste HTML up to ${browserMode ? 16 : 5} MiB.`, true); return; }
    let html = source.value.trim();
    const fenced = html.match(/^```(?:html)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    if (fenced) html = fenced[1].trim();
    if (!/^\s*(?:<!doctype\s+html\b[^>]*>\s*)?<html\b/i.test(html) || !/<\/html\s*>\s*$/i.test(html)) {
      say(t("Paste a complete document from <html> to </html>, without the AI’s explanation."), true); source.focus(); return;
    }
    const name = filename.value.trim() || 'report.html';
    if (!/\.html?$/i.test(name) || /[/\\\u0000-\u001f]/.test(name) || name.length > 180) { say(t("Enter a filename ending in .html or .htm, without a folder path."), true); filename.focus(); return; }
    setBusy(true);
    try { await accept(new File([html], name, { type: 'text/html' })); }
    finally { setBusy(false); }
  });
}
