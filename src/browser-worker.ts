import { describeDocument, editHtml, previewHtml, EditorError, type DocumentDescription } from './editor.js';

export type BrowserWorkerRequest = {
  id: string | number;
  type: 'describe' | 'edit';
  source: string;
  changes?: unknown;
  operations?: unknown;
};
export type BrowserWorkerResponse =
  | { id: string | number; result: DocumentDescription & { hash: string; preview: string; source: string } }
  | { id: string | number | null; error: { message: string; status: number } };

const utf8 = new TextEncoder();
const maxSourceBytes = 16 * 1024 * 1024;
export const browserPreviewPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

function sourceBytes(source: string) {
  // Reject oversized strings before allocating their encoded representation.
  if (source.length > maxSourceBytes) throw new EditorError(413, "HTML documents can be up to 16 MiB.");
  const bytes = utf8.encode(source);
  if (bytes.byteLength > maxSourceBytes) throw new EditorError(413, "HTML documents can be up to 16 MiB.");
  return bytes;
}

export async function handleBrowserRequest(value: unknown): Promise<BrowserWorkerResponse> {
  const request = value && typeof value === 'object' ? value as Partial<BrowserWorkerRequest> : {};
  const id = typeof request.id === 'string' || (typeof request.id === 'number' && Number.isFinite(request.id)) ? request.id : null;
  try {
    if (id === null || !['describe', 'edit'].includes(request.type ?? '') || typeof request.source !== 'string') {
      throw new EditorError(400, "Invalid HTML editing request.");
    }
    let source = request.source;
    let bytes = sourceBytes(source);
    if (request.type === 'edit') {
      source = editHtml(source, request.changes, request.operations);
      bytes = sourceBytes(source);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { id, result: { source, hash, ...describeDocument(source), preview: previewHtml(source, browserPreviewPolicy) } };
  } catch (error) {
    return { id, error: { message: error instanceof Error ? error.message : "Could not process the HTML document.", status: error instanceof EditorError ? error.status : 500 } };
  }
}

// The structural type avoids mixing conflicting DOM and WebWorker TypeScript libs.
const worker = globalThis as unknown as {
  document?: unknown;
  addEventListener?: (type: 'message', handler: (event: { data: unknown }) => void) => void;
  postMessage?: (message: BrowserWorkerResponse) => void;
};
if (typeof worker.document === 'undefined' && worker.addEventListener && worker.postMessage) {
  worker.addEventListener('message', event => {
    void handleBrowserRequest(event.data).then(result => worker.postMessage!(result));
  });
}
