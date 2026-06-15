export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const records = parseRecords(text);
  if (records.length === 0) return [];

  const header = records[0].map((h) => h.trim());
  return records
    .slice(1)
    .filter((cells) => !(cells.length === 1 && cells[0].trim() === ''))
    .map((cells) => {
      const row: CsvRow = {};
      header.forEach((name, i) => {
        row[name] = (cells[i] ?? '').trim();
      });
      return row;
    });
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === ',') {
      record.push(field);
      field = '';
      i += 1;
    } else if (char === '\r') {
      i += 1;
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}
