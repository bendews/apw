import { assertEquals } from "@std/assert";

/**
 * The index is read and written on a path derived from HOME at import time, so
 * each case points HOME at a throwaway directory and imports a fresh copy.
 */
async function isolated() {
  const home = Deno.makeTempDirSync({ prefix: "apw-recall-" });
  Deno.env.set("HOME", home);
  const recall = await import(`./recall.ts?${crypto.randomUUID()}`);
  return { recall, home, index: `${home}/.apw/index.json` };
}

const originalHome = Deno.env.get("HOME") ?? "";
const restore = () => Deno.env.set("HOME", originalHome);

Deno.test("what is recorded can be read back", async () => {
  const { recall, index } = await isolated();
  try {
    recall.record(["b.example.com", "a.example.com"]);
    assertEquals(recall.hosts().sort(), ["a.example.com", "b.example.com"]);
    assertEquals(Deno.statSync(index).isFile, true);
  } finally {
    restore();
  }
});

Deno.test("the file is not readable by anyone else", async () => {
  const { recall, index } = await isolated();
  try {
    recall.record(["a.example.com"]);
    assertEquals(Deno.statSync(index).mode! & 0o077, 0);
  } finally {
    restore();
  }
});

Deno.test("a corrupt index starts over instead of failing the search", async () => {
  const { recall, index, home } = await isolated();
  try {
    Deno.mkdirSync(`${home}/.apw`, { recursive: true });
    Deno.writeTextFileSync(index, "{ this is not json");
    assertEquals(recall.hosts(), []);
    recall.record(["a.example.com"]);
    assertEquals(recall.hosts(), ["a.example.com"]);
  } finally {
    restore();
  }
});

Deno.test("forget drops matching hosts and leaves the rest", async () => {
  const { recall } = await isolated();
  try {
    recall.record(["a.example.com", "b.other.com"]);
    assertEquals(recall.forget("example.com"), 1);
    assertEquals(recall.hosts(), ["b.other.com"]);
  } finally {
    restore();
  }
});

Deno.test("forget with no query removes the file entirely", async () => {
  const { recall, index } = await isolated();
  try {
    recall.record(["a.example.com"]);
    recall.forget();
    assertEquals(recall.hosts(), []);
    assertEquals(Deno.statSync(index).isFile, false);
  } catch (error) {
    assertEquals(error instanceof Deno.errors.NotFound, true);
  } finally {
    restore();
  }
});

Deno.test("recording is skipped entirely when recall is switched off", async () => {
  const { recall, home } = await isolated();
  try {
    Deno.mkdirSync(`${home}/.apw`, { recursive: true });
    Deno.writeTextFileSync(`${home}/.apw/config.json`, JSON.stringify({ recall: false }));
    recall.record(["a.example.com"]);
    assertEquals(recall.hosts(), []);
  } finally {
    restore();
  }
});
