# Fast CSV Reader

A fast, dependency-free CSV reader for Node.js that reads broken CSV files exactly
the way csv-reader 1.0.0 does — and much faster.

## What it is

`run(input)` takes `{ text, header }` and returns `{ columns, rows, errors }`:

- `columns` is the first record when `header` is true, else `null`.
- `rows` holds every other record, each padded with `""` or cut to the first
  record's width.
- `errors` records every broken thing met, in the order met: `stray_cr` (a CR not
  followed by LF outside quotes), `unterminated_quote`, `quote_junk` (characters
  after a closing quote), `short_row` and `long_row` — each with the 1-based line
  its record starts on and its record's index in `rows`.

The reader follows the broken-row policy exactly:

- A U+FEFF at the very start of the text is dropped.
- A record ends at LF or CRLF, and a line left with no characters is no record.
- A field that opens with a quote runs to the next quote that is not doubled;
  `""` inside it is one quote, and each CRLF or lone CR inside it is read as LF.
  What follows its closing quote, up to the next comma or line break, is appended
  as it stands. A quote that never closes is a literal character, and the text
  after it is read again as unquoted.
- A quote inside an unquoted field is a literal character. Fields stay strings,
  never trimmed or converted.

## How it is fast

The text is scanned once, left to right, walking the character codes directly.
Fields are cut out with `slice()` at the delimiters instead of being built up one
character at a time, so a plain field costs one slice and one pass over its own
characters. Only quotes, carriage returns and line feeds ever slow the scan down.

## Results

On a set of six generated cases totalling about 10.6 MB of CSV (1.4–2.0 MB each,
8–18 columns, mixed line endings, quoted phrases and notes, broken rows):

| Reader | CPU time for `run()` on the set |
| --- | --- |
| csv-reader 1.0.0 (reference) | ~720 ms |
| This reader | ~92 ms |

That is about **7.8× faster** than the reference on the same inputs, with
byte-identical answers on every case. The same answers were verified on two
further freshly drawn sets (6/6 cases each) and on 3,000 randomised broken-CSV
inputs plus 82 hand-picked edge cases, with zero mismatches against the
reference. Two runs on the same input produce byte-identical output.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (a JSON array of
`{ id, input }`), answers each one alone with `run()` from `solve.js`, and
writes `/output/answers.json`. Outside a container, `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`. It runs on Node 22
or later, with no dependencies and nothing to install.

## Files

- `solve.js` — the reader: `run(input)` returns `{ columns, rows, errors }`.
- `main.ts` — the driver: reads the cases, answers each with `run`, writes the answers.

## Author

Kamal Mosadegh — contact by email only: kamalmosadegh6977@gmail.com
