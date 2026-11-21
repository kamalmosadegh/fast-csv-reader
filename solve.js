// A fast CSV reader: the same answers as csv-reader 1.0.0, without its one-character-at-a-time
// loop. The text is scanned once, left to right, walking the character codes directly.
// Fields are cut out with slice() at the delimiters, so a plain field costs one slice
// and one pass over its own characters instead of one concatenation per character. Only
// the characters the reference reader treats specially ever slow the scan down: quotes,
// carriage returns and line feeds, and the broken-row cases they create.
//
// The reading policy it reproduces, exactly:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside
//     it is one quote, and each CRLF or lone CR inside it is read as LF; what follows its
//     closing quote, up to the next comma or line break, is appended as it stands
//     (quote_junk, when the field ends); a quote that never closes is a literal
//     character, and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings,
//     never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records
//     after it (every record when header is false), each padded with "" (short_row, with
//     fields: its field count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field counted), row its
//     record's index in rows (null for the header).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

// How a field ended: at a comma (the record goes on), at a line break, or at the end.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `prefix` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Returns the field and how it ended. The scan
  // walks the character codes directly and cuts the field out with one slice, so a
  // plain field costs no allocation until its slice.
  function readUnquoted(prefix, start) {
    let value = prefix;
    let seg = start; // start of the slice not yet added to value
    let i = start;
    while (i < n) {
      const code = text.charCodeAt(i);
      if (code === 44) {
        // ,
        value += text.slice(seg, i);
        pos = i + 1;
        return { value, ended: COMMA };
      }
      if (code === 10) {
        // LF
        value += text.slice(seg, i);
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (code === 13) {
        // CR: with an LF after it a line break, alone a stray CR, dropped.
        if (text.charCodeAt(i + 1) === 10) {
          value += text.slice(seg, i);
          pos = i + 2;
          line += 1;
          return { value, ended: LINE_BREAK };
        }
        error('stray_cr');
        value += text.slice(seg, i);
        seg = i + 1;
        i += 1;
        continue;
      }
      // Any other character, a quote included, is a literal part of the field.
      i += 1;
    }
    value += text.slice(seg);
    pos = n;
    return { value, ended: END };
  }

  // Reads a quoted field whose opening quote is at pos. The scan walks the character
  // codes directly; only a quote, a CR or an LF cuts the slice, so a plain quoted
  // field costs one slice.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let seg = pos + 1; // start of the slice not yet added to value
    let i = pos + 1;
    let closed = false;
    while (i < n) {
      const code = text.charCodeAt(i);
      if (code === 34) {
        // ": doubled, one quote in the value; alone, the field closes.
        if (text.charCodeAt(i + 1) === 34) {
          value += text.slice(seg, i) + '"';
          i += 2;
          seg = i;
          continue;
        }
        value += text.slice(seg, i);
        pos = i + 1;
        closed = true;
        break;
      }
      if (code === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        value += text.slice(seg, i) + '\n';
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
        continue;
      }
      if (code === 10) {
        // An LF inside quotes is part of the value; count the line and keep it in
        // the slice by not cutting here.
        line += 1;
        i += 1;
        continue;
      }
      // A comma or any other character inside quotes is part of the value.
      i += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is
      // read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"', open + 1);
    }
    if (pos >= n) return { value, ended: END };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next comma
    // or line break.
    const before = value.length;
    const junk = readUnquoted(value, pos);
    if (junk.value.length > before) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text[pos];
      if (c === '\n') {
        pos += 1;
        line += 1;
      } else if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text[pos] === '"';
      field = quoted ? readQuoted() : readUnquoted('', pos);
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

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
