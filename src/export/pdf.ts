import * as path from 'node:path';
import * as fs from 'node:fs';
import PDFDocument from 'pdfkit';
import type { Itinerary, DayPlan, ItineraryItem, CostBreakdown } from '../domain.js';

// pdfkit needs a CJK-capable font registered; otherwise Chinese renders as
// blank glyphs. The font lives in the project's assets/ directory.
const FONT_FILE = 'NotoSansSC-Regular.ttf';
const FONT_NAME = 'NotoSansSC';

function resolveFontPath(): string {
  const override = process.env.TRIPMATE_PDF_FONT;
  if (override && fs.existsSync(override)) return override;
  // process.cwd() is the project root for both `tsx src/index.ts` (CLI)
  // and `next dev|start` (web).
  return path.join(process.cwd(), 'assets', 'fonts', FONT_FILE);
}

export interface PDFRenderOptions {
  // When true, render markdown fallback even if structured itinerary present.
  forceMarkdown?: boolean;
  // Header subtitle, e.g. session id or generated-at timestamp.
  subtitle?: string;
}

// Renders a structured itinerary. Returns a Buffer ready to be written/sent.
export async function renderItineraryPDF(
  itinerary: Itinerary,
  opts: PDFRenderOptions = {},
): Promise<Buffer> {
  const doc = makeDoc();
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  drawHeader(doc, '行程安排', opts.subtitle);
  drawCostSummary(doc, itinerary.totalCost);
  if (itinerary.notes) {
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#444').text(`备注:${itinerary.notes}`, { width: 495 });
    doc.fillColor('black');
  }

  for (const day of itinerary.days) {
    drawDay(doc, day);
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

// Markdown-fallback rendering: when no structured itinerary is available,
// just render the latest assistant message text. Keeps things readable but
// gives up structured layout (no cost tables, no per-day pages).
export async function renderMarkdownPDF(
  markdown: string,
  opts: PDFRenderOptions = {},
): Promise<Buffer> {
  const doc = makeDoc();
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  drawHeader(doc, '行程安排', opts.subtitle);
  doc.moveDown(0.5);
  drawMarkdown(doc, markdown);

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

// Pass our CJK font in the constructor so pdfkit never tries to load its
// bundled Helvetica.afm — Next.js doesn't bundle pdfkit's data/ directory
// into route output, which would otherwise ENOENT at runtime.
function makeDoc(): PDFKit.PDFDocument {
  const fontPath = resolveFontPath();
  if (!fs.existsSync(fontPath)) {
    throw new Error(
      `PDF font not found at ${fontPath}. ` +
        `Place a CJK TTF/OTF there or set TRIPMATE_PDF_FONT to its absolute path.`,
    );
  }
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    autoFirstPage: true,
    font: fontPath,
  });
  doc.registerFont(FONT_NAME, fontPath);
  doc.font(FONT_NAME);
  return doc;
}

function drawHeader(doc: PDFKit.PDFDocument, title: string, subtitle?: string): void {
  doc.fontSize(22).fillColor('black').text(title, { align: 'left' });
  if (subtitle) {
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#666').text(subtitle);
    doc.fillColor('black');
  }
  doc.moveDown(0.5);
  // Divider
  const y = doc.y;
  doc
    .strokeColor('#ddd')
    .lineWidth(1)
    .moveTo(50, y)
    .lineTo(545, y)
    .stroke();
  doc.strokeColor('black');
  doc.moveDown(0.6);
}

function drawCostSummary(doc: PDFKit.PDFDocument, cost: CostBreakdown | undefined): void {
  if (!cost) return;
  doc.fontSize(13).text('费用总览', { underline: false });
  doc.moveDown(0.3);
  const rows: [string, number | undefined][] = [
    ['交通(机票)', cost.flightsCNY],
    ['住宿', cost.hotelsCNY],
    ['市内交通', cost.transitCNY],
    ['餐饮', cost.foodCNY],
    ['活动', cost.activitiesCNY],
  ];
  doc.fontSize(10).fillColor('#222');
  for (const [label, value] of rows) {
    if (value === undefined) continue;
    doc.text(`${label}: ¥${formatMoney(value)}`);
  }
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor('black').text(`合计: ¥${formatMoney(cost.totalCNY)}`);
  doc.moveDown(0.6);
}

function drawDay(doc: PDFKit.PDFDocument, day: DayPlan): void {
  // Each day starts on a new page if there's not enough room.
  if (doc.y > 700) doc.addPage();
  doc.fontSize(14).fillColor('black').text(`${day.date} · ${day.city}`);
  if (day.estCostCNY !== undefined) {
    doc.fontSize(10).fillColor('#666').text(`当日预估: ¥${formatMoney(day.estCostCNY)}`);
    doc.fillColor('black');
  }
  doc.moveDown(0.3);

  for (const item of day.items) {
    drawItem(doc, item);
  }
  doc.moveDown(0.4);
}

function drawItem(doc: PDFKit.PDFDocument, item: ItineraryItem): void {
  if (doc.y > 760) doc.addPage();
  const time = item.time ? `[${item.time}] ` : '';
  doc.fontSize(11).fillColor('black').text(`• ${time}${item.title}`, { indent: 6 });
  const subParts: string[] = [];
  if (item.location) subParts.push(`📍 ${item.location}`);
  if (item.estCostCNY !== undefined) subParts.push(`¥${formatMoney(item.estCostCNY)}`);
  if (subParts.length > 0) {
    doc.fontSize(9).fillColor('#666').text(subParts.join('  ·  '), { indent: 18 });
  }
  if (item.notes) {
    doc.fontSize(9).fillColor('#444').text(item.notes, { indent: 18, width: 480 });
  }
  doc.fillColor('black');
  doc.moveDown(0.2);
}

// Lightweight markdown rendering: handles headings, bullets, bold-ish
// emphasis. Not a full markdown parser — just enough that a typical
// assistant reply renders sanely.
function drawMarkdown(doc: PDFKit.PDFDocument, md: string): void {
  const lines = md.split('\n');
  for (const raw of lines) {
    if (doc.y > 770) doc.addPage();
    const line = raw.trimEnd();
    if (line === '') {
      doc.moveDown(0.3);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const sizes = [18, 16, 14, 12, 11, 10];
      doc.fontSize(sizes[level - 1] ?? 10).fillColor('black').text(heading[2]);
      doc.moveDown(0.2);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      doc.fontSize(10).fillColor('black').text(`• ${stripInline(bullet[1])}`, {
        indent: 8,
        width: 490,
      });
      continue;
    }
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      doc.fontSize(10).fillColor('black').text(line, { indent: 8, width: 490 });
      continue;
    }
    doc.fontSize(10).fillColor('black').text(stripInline(line), { width: 495 });
  }
}

function stripInline(s: string): string {
  // Strip **bold**, *italic*, `code`, [text](link) → text. PDFKit doesn't
  // do inline formatting changes mid-paragraph cleanly, so flatten them.
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1');
}

function formatMoney(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
