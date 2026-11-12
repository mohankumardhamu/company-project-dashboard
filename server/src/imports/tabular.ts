import ExcelJS from 'exceljs';
import { badRequest } from '../http';

/**
 * Reads the first sheet of an .xlsx, or a .csv, into header-keyed rows of
 * trimmed strings. Headers are matched loosely (case, spaces and punctuation
 * ignored) so "Time Spent", "TimeSpent" and "time_spent" all resolve to the
 * same column — exports from Rally and Keka vary a little between versions.
 */

export interface TableRow {
  /** 1-based row number as the user sees it in Excel, for error messages. */
  rowNumber: number;
  values: Record<string, string>;
}

export interface ColumnSpec {
  /** Key the parsed row is stored under. */
  key: string;
  /** Header as the user would write it, used in error messages. */
  label: string;
  /** Alternative spellings seen in real exports. */
  aliases?: string[];
  required: boolean;
}

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text; // hyperlink
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue); // formula
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readGrid(buf: Buffer, fileName: string): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(buf.toString('utf8'));
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw badRequest('That file could not be read as an Excel workbook (.xlsx)');
    }
    const sheet = wb.worksheets[0];
    if (!sheet) throw badRequest('The workbook has no sheets');
    const grid: string[][] = [];
    for (let r = 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= Math.max(sheet.columnCount, row.cellCount); c += 1) {
        cells.push(cellText(row.getCell(c).value));
      }
      grid.push(cells);
    }
    return grid;
  }
  throw badRequest('Upload an .xlsx or .csv file');
}

/**
 * Finds the header row (the first of the top 10 rows that contains every
 * required column — exports sometimes put a title above the table), then
 * returns each following non-blank row keyed by ColumnSpec.key.
 */
export async function readTable(
  buf: Buffer,
  fileName: string,
  columns: ColumnSpec[]
): Promise<{ rows: TableRow[]; headerRow: number }> {
  const grid = await readGrid(buf, fileName);
  const wanted = columns.map((c) => ({
    ...c,
    names: [c.label, ...(c.aliases ?? [])].map(normalizeHeader),
  }));

  for (let h = 0; h < Math.min(10, grid.length); h += 1) {
    const headers = grid[h].map((x) => normalizeHeader(x));
    const index = new Map<string, number>();
    for (const col of wanted) {
      const i = headers.findIndex((x) => col.names.includes(x));
      if (i >= 0) index.set(col.key, i);
    }
    if (!wanted.every((c) => !c.required || index.has(c.key))) continue;

    const rows: TableRow[] = [];
    for (let r = h + 1; r < grid.length; r += 1) {
      const cells = grid[r].map((x) => x.trim());
      if (cells.every((x) => x === '')) continue;
      const values: Record<string, string> = {};
      for (const col of wanted) {
        const i = index.get(col.key);
        values[col.key] = i === undefined ? '' : (cells[i] ?? '');
      }
      rows.push({ rowNumber: r + 1, values });
    }
    return { rows, headerRow: h + 1 };
  }

  const missing = columns.filter((c) => c.required).map((c) => c.label);
  throw badRequest(`Could not find the header row. The sheet needs these columns: ${missing.join(', ')}`);
}

/** Parses a numeric cell; blank counts as 0, anything else non-numeric is an error. */
export function parseNumber(raw: string): number | null {
  if (raw === '') return 0;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
