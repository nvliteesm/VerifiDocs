// Reads tables as tables. A pasted Google Doc or Word table arrives as a column of loose cells, one per line, row after
// row, so "135" is a number with no name and the model has to guess which column it belongs to. This rebuilds each table
// into one line per row with its column headings ("Umur (hari) = 7; Ukuran (cm²) = 135; ..."), so a figure keeps its
// context. Plain code, no model. Anything that does not look like a table of this shape is returned unchanged.
//
// The shape it knows (from a real Google Docs export): a caption line ("Tabel 4.1 ..."), then the first heading cell on
// its own line, then every other cell on a line that starts with a tab. A short line starting with "(" is the second line
// of the cell before it ("Umur" then "(hari)").

const CAPTION = /^(?:tabel|table)\s+\d+(?:[.-]\d+)*\b/i;
const MAX_COLUMNS = 14;
const isNumeric = (cell: string) => /^[-+]?\d[\d.,\s]*\s*(?:%|[a-zA-Z/²³]{1,6})?$/.test(cell.trim());

interface Block {
  start: number;
  end: number;
  caption: string;
  cells: string[];
}

function readBlock(lines: string[], at: number): Block | null {
  const caption = lines[at]!.trim();
  let index = at + 1;
  const first = lines[index];
  if (first === undefined || first.startsWith("\t") || first.trim() === "") return null;
  const cells: string[] = [first.trim()];
  index += 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === "") break;
    if (line.trim().length > 70) break;
    if (line.startsWith("\t")) cells.push(line.trim());
    else if (/^[(\p{Ll}]/u.test(line.trim()) && line.trim().length <= 24) cells[cells.length - 1] += ` ${line.trim()}`;
    else break;
  }
  return cells.length >= 6 ? { start: at, end: index, caption, cells } : null;
}

// A schedule (weeks under month names) is not a table of measurements and its cells carry no figure: not rebuilt.
const MONTH = /^(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december)$/i;

/**
 * How many columns the table has: the smallest K for which the first K cells are all headings (none a number) and every
 * full row after them has the same kind of cell in each column (a number column stays numbers, a label column stays
 * labels). If no K fits, the table is not read, because wrong headings are worse than none.
 */
function columnCount(cells: string[]): number | null {
  for (let k = 2; k <= MAX_COLUMNS; k += 1) {
    const body = cells.slice(k);
    const rows = Math.floor(body.length / k);
    if (rows < 2 || cells.slice(0, k).some((cell) => isNumeric(cell))) continue;
    const kinds = Array.from({ length: k }, (_, c) => isNumeric(body[c]!));
    let fits = kinds.some(Boolean);
    for (let r = 1; r < rows && fits; r += 1) for (let c = 0; c < k; c += 1) if (isNumeric(body[r * k + c]!) !== kinds[c]) fits = false;
    if (fits) return k;
  }
  return null;
}

function rowsOf(block: Block): string[] | null {
  const columns = columnCount(block.cells);
  if (columns === null) return null;
  if (block.cells.slice(0, columns).some((cell) => MONTH.test(cell))) return null;
  const headings = block.cells.slice(0, columns);
  const body = block.cells.slice(columns);
  const rows: string[] = [];
  for (let i = 0; i < body.length; i += columns) {
    const row = body.slice(i, i + columns);
    if (row.length === columns) {
      rows.push(row.map((cell, c) => `${headings[c]} = ${cell}`).join("; "));
    } else {
      // A short last row (a total or an average) has fewer cells: they sit under the last headings.
      rows.push(row.map((cell, c) => (c === 0 && !isNumeric(cell) ? cell : `${headings[columns - row.length + c]} = ${cell}`)).join("; "));
    }
  }
  return rows.length > 0 ? rows : null;
}

export function tablesAsRows(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const block = CAPTION.test(lines[i]!.trim()) ? readBlock(lines, i) : null;
    const rows = block ? rowsOf(block) : null;
    if (!block || !rows) {
      out.push(lines[i]!);
      continue;
    }
    out.push(lines[i]!.trim());
    for (const row of rows) out.push(`[${block.caption}] ${row}`);
    i = block.end - 1;
  }
  return out.join("\n");
}

/** The caption a rebuilt table row carries, or null for any other sentence. */
export function tableCaptionOf(sentence: string): string | null {
  const match = /^\[((?:tabel|table)\s[^\]]+)\]/i.exec(sentence.trim());
  return match ? match[1]! : null;
}
