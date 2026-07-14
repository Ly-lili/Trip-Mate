import type { LLMClient } from '../llm/client.js';
import type { Logger } from '../observability.js';
import type { Session, SessionStore } from '../session/store.js';
import { extractItinerary, latestAssistantMarkdown } from './extract.js';
import { renderItineraryPDF, renderMarkdownPDF } from './pdf.js';

export interface ExportPDFOptions {
  llm: LLMClient;
  sessions: SessionStore;
  logger?: Logger;
  // If true, skip cache and always re-extract from messages. The CLI exposes
  // this so the user can refresh after more conversation turns.
  force?: boolean;
}

export interface ExportPDFResult {
  buffer: Buffer;
  source: 'structured' | 'markdown';
  bytes: number;
}

// Orchestrates: try structured extract (cached on session.itinerary), render
// the PDF, fall back to latest-assistant-markdown rendering if no itinerary
// could be extracted.
export async function exportSessionPDF(
  session: Session,
  opts: ExportPDFOptions,
): Promise<ExportPDFResult> {
  const subtitle = `Session: ${session.id} · Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  let itinerary = opts.force ? null : session.workspace?.itinerary ?? session.itinerary ?? null;
  if (!itinerary) {
    itinerary = await extractItinerary(session, { llm: opts.llm, logger: opts.logger });
    if (itinerary) {
      await opts.sessions.setItinerary(session.id, itinerary);
    }
  }

  if (itinerary && itinerary.days.length > 0) {
    const buffer = await renderItineraryPDF(itinerary, { subtitle });
    return { buffer, source: 'structured', bytes: buffer.byteLength };
  }

  const markdown = latestAssistantMarkdown(session);
  if (!markdown) {
    throw new Error('No itinerary or assistant message available to export.');
  }
  const buffer = await renderMarkdownPDF(markdown, { subtitle });
  return { buffer, source: 'markdown', bytes: buffer.byteLength };
}
