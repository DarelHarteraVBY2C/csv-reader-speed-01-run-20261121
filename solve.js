// Fast drop-in for csv-reader 1.0.0 (make.fun's reference CSV reader).
// run(input) returns exactly csv-reader 1.0.0's {columns, rows, errors}
// for {text, header}, following its written broken-row policy:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled; "" inside it is one quote and each CRLF or lone CR inside
//     it reads as LF; what follows its closing quote, up to the next comma
//     or line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character and the text
//     after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - columns is the first record when header is true, else null; rows are
//     padded (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row} in the order met, a record's
//     short_row/long_row when it ends; line is the 1-based line its record
//     starts on, row its index in rows (null for the header).
//
// Speed: the reference walks one character at a time and builds every
// field a character at a time. This reader jumps with indexOf to the next
// delimiter and slices whole fields out at once. Every scan is bounded
// by the field or line it reads: a stray CR is found by looking at the
// short slice just cut, never by scanning the rest of the file for one.
// The hot path (a clean unquoted field) is inlined in the record loop
// with no call and no temporary per field. Corruption (stray CR, quote
// junk, unterminated quote, embedded line breaks) is rare, so those
// paths may take their time.

const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const QUOTE = 34; // "
const BOM = 0xFEFF;

// Normalize a quoted field's raw content (between its quotes): each CRLF
// and each lone CR becomes one LF, and each "" becomes one quote.
// Returns [value, lineBreaks], lineBreaks counting CRLF, lone CR and LF
// each as one (the reference counts each of them as one line).
function normalizeQuoted(raw) {
  let parts = null;
  let breaks = 0;
  let start = 0;
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw.charCodeAt(i);
    if (c === CR) {
      if (parts === null) parts = [raw.slice(start, i)];
      else parts.push(raw.slice(start, i));
      parts.push('\n');
      breaks += 1;
      i += (i + 1 < n && raw.charCodeAt(i + 1) === LF) ? 2 : 1;
      start = i;
    } else if (c === LF) {
      if (parts === null) parts = [raw.slice(start, i)];
      else parts.push(raw.slice(start, i));
      parts.push('\n');
      breaks += 1;
      i += 1;
      start = i;
    } else if (c === QUOTE) {
      // A quote here is always half of a doubled pair (a lone quote
      // would have closed the field), so it becomes one quote.
      if (parts === null) parts = [raw.slice(start, i)];
      else parts.push(raw.slice(start, i));
      parts.push('"');
      i += 2;
      start = i;
    } else {
      i += 1;
    }
  }
  if (parts === null) return [raw, 0];
  parts.push(raw.slice(start));
  return [parts.join(''), breaks];
}

// Drop every CR from a field's content, recording one stray_cr error per
// CR dropped. Returns the cleaned value.
function dropStrayCr(content, errors, recordLine, recordRow) {
  let parts = null;
  let start = 0;
  let i = 0;
  for (;;) {
    const idx = content.indexOf('\r', i);
    if (idx === -1) break;
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    if (parts === null) parts = [content.slice(start, idx)];
    else parts.push(content.slice(start, idx));
    i = idx + 1;
    start = i;
  }
  if (parts === null) return content;
  parts.push(content.slice(start));
  return parts.join('');
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === BOM) pos = 1;

  // The record being read: the line it starts on and its index in rows
  // (null for the header).
  let recordLine = 1;
  let recordRow = null;

  // Scan an unquoted stretch starting at pos, beginning with value init.
  // Only used on the rare paths (quote junk after a closing quote, and
  // the re-read after an unterminated quote). Returns [value, end,
  // added]: end 0 at a comma, 1 at a line break, 2 at the end of the
  // text; added counts the characters kept. Updates pos and line, and
  // records stray_cr errors as they are met.
  function scanUnq(init) {
    const cI = text.indexOf(',', pos);
    const nI = text.indexOf('\n', pos);
    let end = n;
    let kind = 3; // 0 comma, 1 LF, 3 end of text
    if (cI !== -1 && cI < end) { end = cI; kind = 0; }
    if (nI !== -1 && nI < end) { end = nI; kind = 1; }
    let contentEnd = end;
    if (kind === 1 && end > pos && text.charCodeAt(end - 1) === CR) contentEnd = end - 1; // CRLF
    let content = text.slice(pos, contentEnd);
    let added = content.length;
    if (content.indexOf('\r') !== -1) {
      content = dropStrayCr(content, errors, recordLine, recordRow);
      added = content.length;
    }
    const value = init + content;
    if (kind === 0) { pos = end + 1; return [value, 0, added]; }
    if (kind === 1) { pos = end + 1; line += 1; return [value, 1, added]; }
    pos = n;
    return [value, 2, added];
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) { pos += 1; line += 1; }
      else if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = (header && columns === null) ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let fEnd = 2;
    for (;;) {
      let value;
      if (pos < n && text.charCodeAt(pos) === QUOTE) {
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        // Find the closing quote: the next quote that is not doubled.
        let q = pos + 1;
        let close = -1;
        let doubled = false;
        for (;;) {
          const idx = text.indexOf('"', q);
          if (idx === -1) break;
          if (idx + 1 < n && text.charCodeAt(idx + 1) === QUOTE) {
            doubled = true;
            q = idx + 2;
            continue;
          }
          close = idx;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          const r = scanUnq('"');
          value = r[0];
          fEnd = r[1];
        } else {
          const raw = text.slice(open + 1, close);
          let v;
          if (!doubled && raw.indexOf('\n') === -1 && raw.indexOf('\r') === -1) {
            v = raw;
          } else {
            const norm = normalizeQuoted(raw);
            v = norm[0];
            line += norm[1];
          }
          pos = close + 1;
          if (pos >= n) {
            value = v;
            fEnd = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === COMMA) { pos += 1; value = v; fEnd = 0; }
            else if (c === LF) { pos += 1; line += 1; value = v; fEnd = 1; }
            else if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) { pos += 2; line += 1; value = v; fEnd = 1; }
            else {
              // What follows the closing quote is appended as it stands,
              // up to the next comma or line break.
              const r = scanUnq(v);
              value = r[0];
              fEnd = r[1];
              if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      } else {
        // Unquoted field, inlined: the field ends at the first comma or
        // LF (or the end of the text). A CR before that end is either
        // the CR of a CRLF line ending (only when it sits right before
        // the LF) or a stray CR, dropped: either way it is found by
        // looking at the short slice just cut.
        lastQuoted = false;
        const cI = text.indexOf(',', pos);
        const nI = text.indexOf('\n', pos);
        let end = n;
        let kind = 3; // 0 comma, 1 LF, 3 end of text
        if (cI !== -1 && cI < end) { end = cI; kind = 0; }
        if (nI !== -1 && nI < end) { end = nI; kind = 1; }
        let contentEnd = end;
        if (kind === 1 && end > pos && text.charCodeAt(end - 1) === CR) contentEnd = end - 1; // CRLF
        let content = text.slice(pos, contentEnd);
        if (content.indexOf('\r') !== -1) content = dropStrayCr(content, errors, recordLine, recordRow);
        value = content;
        if (kind === 0) { pos = end + 1; fEnd = 0; }
        else if (kind === 1) { pos = end + 1; line += 1; fEnd = 1; }
        else { pos = n; fEnd = 2; }
      }
      fields.push(value);
      if (fEnd !== 0) break;
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
