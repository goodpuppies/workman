import * as Won from "../interop.ts";
import { pathToFileURL } from "node:url";

// The Python harness supplies a freshly compiled WM library, so this exercises
// real backend values rather than hand-made copies of their representation.
const raw = await import(pathToFileURL(Deno.args[0]).href) as Won.WonModule;
const WON = Won.bind(raw);
function assert(ok: boolean): asserts ok {
  if (!ok) throw new Error("assertion failed");
}
function throws(action: () => unknown, message: string): void {
  try {
    action();
  } catch (e) {
    assert(e instanceof Error && e.message === message);
    return;
  }
  throw new Error(`expected error: ${message}`);
}

Deno.test("access chains read records, text, numbers, blobs, tags and lists", () => {
  const doc = WON.parse(
    '{title = "café 😀" port = 9007199254740993123456789 debug = false payload = x"0001ff" nested = {"ä" = "yes"} items = [null true] tag = Node<id = 1>("body")}',
  );
  assert(doc.entries().map(([key]) => key).join(",") === "title,port,debug,payload,nested,items,tag");
  assert(doc.get("title").text() === "café 😀");
  assert(doc.get("port").number() === "9007199254740993123456789");
  assert(doc.get("debug").boolean() === false);
  assert([...doc.get("payload").blob()].join(",") === "0,1,255");
  assert(doc.get("nested").get("ä").text() === "yes");
  assert(doc.get("items").items().map((item) => item.value().name).join(",") === "Null,Boolean");
  const tag = doc.get("tag");
  assert(tag.tagName() === "Node" && tag.attribute("id").number() === "1" && tag.payload().text() === "body");
  assert(WON.parse('"﻿hello"').text() === "﻿hello");
  assert(WON.parse(new TextEncoder().encode("[1E+5]")).index(0).number() === "1E+5");
});

Deno.test("problems surface at the end of a chain with their path", () => {
  const doc = WON.parse('{server = {port = 8080} items = [1] none = null "odd key" = true}');
  throws(() => doc.get("server").get("debug").get("deeper").boolean(), "server.debug: missing");
  throws(() => doc.get("items").get("x").text(), "items: expected record");
  throws(() => doc.get("items").index(3).number(), "items[3]: missing");
  throws(() => doc.get("odd key").get("x").value(), '"odd key": expected record');
  throws(() => doc.get("none").text(), "none: expected text");
  throws(() => doc.number(), "document: expected number");
  assert(doc.get("nope").get("deeper").optional() === undefined);
  assert(doc.get("none").optional()?.value().name === "Null");
  throws(() => doc.get("items").get("x").optional(), "items: expected record");
  const [, port] = doc.get("server").entries()[0];
  throws(() => port.text(), "server.port: expected text");
  throws(() => doc.get("items").items()[0].boolean(), "items[0]: expected boolean");
});

Deno.test("parse and stringify behave like JSON's entry points", () => {
  throws(() => WON.parse("{"), "byte 1: expected name");
  let syntax: unknown;
  try {
    WON.parse("[1 02]");
  } catch (e) {
    syntax = e;
  }
  assert(syntax instanceof Won.WonSyntaxError && syntax.offset === 3);
  const doc = WON.parse('{a = 1, b = "ä", c = X<k = 1>[]}');
  assert(WON.stringify(doc) === '{a = 1 b = "ä" c = X<k = 1>[]}');
  assert(WON.stringify(doc.get("c").value()) === "X<k = 1>[]");
});

Deno.test("list conversion handles empty and long actual WM lists", () => {
  assert(WON.parse("[]").items().length === 0);
  assert(WON.parse("[" + Array(3000).fill("true").join(" ") + "]").items().length === 3000);
});

Deno.test("byte carriers preserve every octet and reject Unicode masquerading as bytes", () => {
  const bytes = Uint8Array.from({ length: 10000 }, (_, i) => i % 256);
  const restored = Won.stringToBytes(Won.bytesToString(bytes));
  assert(restored.every((v, i) => v === bytes[i]));
  assert(Won.stringToBytes(Won.bytesToString(new Uint8Array())).length === 0);
  let rejected = false;
  try {
    Won.stringToBytes("😀");
  } catch (e) {
    rejected = e instanceof TypeError;
  }
  assert(rejected);
});
