// Generator AND drift-guard for the committed IDF table (idf-table.json).
//
// One implementation, self-verifying: this test rebuilds the IDF table from the
// real Brain KB corpus using the SAME feature/chunk logic the embedder uses,
// then asserts it matches the committed idf-table.json byte-for-byte (via deep
// equality). If the tokenizer, the chunker, or the corpus changes without the
// table being regenerated, this test fails — so the shipped weights can never
// silently drift from the code that produced them.
//
// To regenerate after an intentional corpus/tokenizer change:
//     UPDATE_IDF=1 npx jest lib/brains/idf-table.test.ts
// which rewrites idf-table.json and passes. Commit the updated JSON, then
// re-ingest / re-embed so stored vectors move to the new hash-v3 space.

import { promises as fs } from "fs";
import path from "path";
import { buildIdfTable, type IdfTable } from "./idf";
import { chunkText } from "./vector";
import { BRAINS } from "./catalog";

const KNOWLEDGE_DIR = path.join(process.cwd(), "lib", "brains", "knowledge");
const REFERENCE_DIR = path.join(KNOWLEDGE_DIR, "reference");
const TABLE_PATH = path.join(process.cwd(), "lib", "brains", "idf-table.json");

// The IDF corpus is exactly what the ingest route embeds: each brain's own
// <brain_key>.md plus every shared reference doc — each physical file counted
// once. (README.md documents the corpus; it is not ingested, so it is excluded.)
async function corpusChunks(): Promise<string[]> {
  const files = new Set<string>();
  for (const brain of BRAINS) files.add(path.join(KNOWLEDGE_DIR, `${brain.key}.md`));
  let refs: string[] = [];
  try {
    refs = (await fs.readdir(REFERENCE_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    refs = [];
  }
  for (const f of refs) files.add(path.join(REFERENCE_DIR, f));

  const chunks: string[] = [];
  for (const file of [...files].sort()) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue; // a brain with no KB file yet is fine
    }
    for (const chunk of chunkText(content)) chunks.push(chunk);
  }
  return chunks;
}

describe("idf-table.json", () => {
  it("matches a fresh build from the committed corpus (regenerate with UPDATE_IDF=1)", async () => {
    const built = buildIdfTable(await corpusChunks());

    if (process.env.UPDATE_IDF) {
      await fs.writeFile(TABLE_PATH, `${JSON.stringify(built, null, 0)}\n`, "utf8");
      return;
    }

    const committed = JSON.parse(await fs.readFile(TABLE_PATH, "utf8")) as IdfTable;
    expect(committed.chunkCount).toBe(built.chunkCount);
    expect(committed.default).toBe(built.default);
    expect(committed.idf).toEqual(built.idf);
  });

  it("down-weights ubiquitous terms below rare ones", async () => {
    const built = buildIdfTable(await corpusChunks());
    const values = Object.values(built.idf);
    // The rarest stored term should carry more weight than the commonest.
    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values));
    // Nothing exceeds the df=1 default (that is the ceiling by construction).
    expect(Math.max(...values)).toBeLessThanOrEqual(built.default);
  });
});
