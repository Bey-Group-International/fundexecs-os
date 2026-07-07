# Document upload validation & institutional formatting

Every surface that accepts a tabular document upload (Network contact import,
Build › Entity ownership cap-table import, and the shared `CsvImport` component)
runs through one reusable validation layer so the behaviour — accepted formats,
error messages, mismatch detection — is identical everywhere.

## Modules

### `lib/file-validation.ts` (isomorphic — client + server)

The single source of truth for what is accepted and why. No Node- or
browser-only imports, so it runs in Server Components, route handlers, and
`"use client"` components alike.

|                    Export                    |                                                                          Purpose                                                                          |
|----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `detectFileType(file)`                       | Resolve the real kind from extension **+** MIME **+** magic-byte signature. Signature wins over extension.                                                |
| `validateFileType(file, opts?)`              | Allowlist enforcement + extension/content mismatch detection + size guard (`opts.maxBytes`). Returns `{ ok, kind, error }` with one human-readable message. |
| `decodeText(bytes)`                          | BOM-aware decode (UTF-16LE/BE, UTF-8) — Excel's default CSV exports are UTF-16, so decode through this, not `File.text()`.                                 |
| `parseCSV(text)`                             | RFC 4180 parser (quotes, escaped quotes, embedded newlines, BOM).                                                                                         |
| `normalizeInstitutionalFormat(rows, schema)` | Auto-map source columns to the internal schema, validate required fields, reorder columns/rows into institutional order, and surface `errors`/`warnings`. |
| `returnUserFacingErrors(errors, context?)`   | Aggregate problems into a consistent, logged, non-throwing payload.                                                                                       |
| `readFileHead(blob, n?)`                     | Browser helper — read the first `n` bytes for signature sniffing.                                                                                         |
| `ACCEPTED_UPLOAD_ATTR`                       | Value for `<input type="file" accept=…>`.                                                                                                                 |
| `ACCEPTED_FORMATS_HELP`                      | Data for "View accepted formats" tooltips/links.                                                                                                          |
| `UNSUPPORTED_FILE_MESSAGE`                   | The canonical rejection copy.                                                                                                                             |
| `MAX_UPLOAD_BYTES`                           | Default per-file size ceiling (10 MB) for client surfaces; the server route may set a stricter `maxBytes`.                                                |

Supported formats today: **CSV (`.csv`)** and **Excel (`.xlsx`)**. Extend by
adding a `FormatSpec` to `SUPPORTED_FORMATS`.

Encoding: pass `size: file.size` to `validateFileType` to enable the size guard,
and read bytes via `arrayBuffer()` + `decodeText()` (not `File.text()`, which is
UTF-8 only) so UTF-16 spreadsheet exports parse correctly.

### `lib/xlsx.ts` (isomorphic — no dependencies)

`xlsxToRows(bytes, opts?)` unzips an `.xlsx` (ZIP central directory → inflate →
parse `sheet1.xml` + `sharedStrings.xml`) into a `string[][]`. Inflation uses the
standard `DecompressionStream` Web API (present in browsers and Node 18+), so the
module is dependency-free and isomorphic. `rowsToCsv(rows)` serializes a matrix
back to CSV text so XLSX uploads can flow through the existing CSV pipelines
unchanged.

Scope: STORE + DEFLATE entries, shared/inline strings, numeric cells, and column
gaps — the shape produced by Excel, Google Sheets, and Numbers. It is a
pragmatic reader, not a full OOXML implementation.

**Hardening.** A hostile or corrupt workbook can't exhaust memory: only the two
needed parts are ever inflated, total inflated bytes are capped
(`MAX_INFLATED_BYTES`, overridable via `opts.maxInflatedBytes` — the inflate
stream aborts mid-flight on overflow), row/column counts are bounded to Excel's
real maximums, every ZIP offset is bounds-checked against the buffer, and ZIP64
archives are refused with a clear message rather than misread.

## How detection works

1. **Extension** gives the declared kind.
2. **MIME** confirms it (only when unambiguous — shared types like
   `application/vnd.ms-excel` are ignored).
3. **Signature** (leading bytes) gives the real content family:
   `zip` (xlsx/docx/pptx/zip), `ole` (legacy `.xls`/`.doc`), `text` (CSV/plain),
   or `binary`. A UTF-8/UTF-16 byte-order mark is recognised as `text` up front
   (so BOM'd Excel CSVs aren't misread as binary). The signature overrides the
   extension.

Mismatches produce specific, actionable copy, e.g.:

- `.csv` whose bytes are a ZIP → *"named .csv but is actually an Excel/ZIP file…"*
- `.xlsx` whose bytes are plain text → *"named .xlsx but is actually plain text…"*
- `.xlsx` whose bytes are OLE → *"looks like a legacy Excel (.xls) file…"*
- anything else (`.txt`, `.png`, `.pdf`, …) → the canonical
  `UNSUPPORTED_FILE_MESSAGE`.

## Adding validation to a new upload surface

Client component:

```tsx
import { ACCEPTED_UPLOAD_ATTR, decodeText, readFileHead, validateFileType } from "@/lib/file-validation";
import { xlsxToRows, rowsToCsv } from "@/lib/xlsx";

async function onPick(file: File) {
  const head = await readFileHead(file);
  const check = validateFileType(
    { name: file.name, mime: file.type, head, size: file.size },
    { accept: ["csv", "xlsx"] },
  );
  if (!check.ok) return setError(check.error);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const csv = check.kind === "xlsx"
    ? rowsToCsv(await xlsxToRows(bytes))
    : decodeText(bytes); // BOM-aware; handles UTF-16 Excel exports
  // …parse csv, normalizeInstitutionalFormat, submit…
}
```

```tsx
<input type="file" accept={ACCEPTED_UPLOAD_ATTR} onChange={/* … */} />
```

Route handler: read `arrayBuffer()`, pass `head: bytes.subarray(0, 512)` to
`validateFileType`, then branch on `check.kind` exactly as above. See
`app/api/network/import/route.ts` for the reference implementation.

## Tests

- `lib/file-validation.test.ts` — signatures, detection, mismatch messages,
  CSV parsing, institutional normalization, error aggregation, BOM/UTF-16
  decoding, and the size guard.
- `lib/xlsx.test.ts` — from-scratch ZIP fixtures (STORE + DEFLATE) exercise the
  reader end to end, plus hardening cases: inflated-byte budget, ZIP64 refusal,
  out-of-bounds entry sizes, and out-of-range column references.

