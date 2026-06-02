export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printTable(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<unknown>>): void {
  const rendered = rows.map((row) => row.map((value) => sanitizeCell(value)));
  const widths = headers.map((header) => header.length);
  for (const row of rendered) {
    row.forEach((value, index) => {
      widths[index] = Math.max(widths[index] ?? 0, value.length);
    });
  }
  printTableRow(headers, widths);
  for (const row of rendered) printTableRow(row, widths);
}

export function printKeyValues(rows: ReadonlyArray<readonly [string, unknown]>): void {
  const width = Math.max(0, ...rows.map(([key]) => key.length));
  for (const [key, value] of rows) {
    process.stdout.write(`${key.padEnd(width)}  ${sanitizeCell(value)}\n`);
  }
}

export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function printMessages(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string; readonly createdAt?: string }>,
): void {
  messages.forEach((message, index) => {
    if (index > 0) process.stdout.write("\n");
    const stamp = message.createdAt ? ` ${message.createdAt}` : "";
    process.stdout.write(`[${message.role}${stamp}]\n${message.text.trim()}\n`);
  });
}

function printTableRow(row: ReadonlyArray<string>, widths: ReadonlyArray<number>): void {
  const columns = widths.map((width, index) => {
    const value = row[index] ?? "";
    return index + 1 === widths.length ? value : value.padEnd(width);
  });
  process.stdout.write(`${columns.join("  ")}\n`);
}
