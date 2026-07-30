export type ParityFixture = Readonly<{
  name: string;
  source: string;
}>;

export type FormatterFixture = Readonly<{
  name: string;
  source: string;
  real: string;
  realFix: string;
}>;

export const recognizerSmokeFixtures: readonly ParityFixture[] = Object.freeze([
  { name: "workman import", source: 'from "./dep.wm" import { Thing as alias };' },
  { name: "javascript import", source: 'from js.module("./dep.mjs") import unsafe { value };' },
  {
    name: "mutual let",
    source:
      "let rec even = match(n) => { 0 => { true }, _ => { odd(n - 1) } } and odd = match(n) => { 0 => { false }, _ => { even(n - 1) } };",
  },
  { name: "type variants", source: "type Option<T> = | None | Some<T>;" },
  { name: "record", source: "record Pair<A, B> = { first: A, second: B };" },
  { name: "block", source: "let main = () => { let value = 1; print(value); value };" },
  { name: "if", source: "let choose = (flag) => { if (flag) { yes } else { no } };" },
  {
    name: "pipe and tuple application",
    source: "let result = source :> transform(1, 2) :> finish;",
  },
  { name: "records and lists", source: "let value = .{ ..base, items = [head, ..tail] };" },
  { name: "carrier lift", source: "let combined = Result|left, right|;" },
]);

export const negativeRecognizerSmokeFixtures: readonly ParityFixture[] = Object.freeze([
  { name: "missing let pattern", source: "let = 1;" },
  { name: "lowercase type name", source: "type option = None;" },
  { name: "missing record fields", source: "record Point =;" },
  { name: "if without else", source: "let choose = if (flag) { yes };" },
  { name: "invalid import clause", source: 'from "./dep.wm" import Thing;' },
  { name: "unterminated string", source: 'let value = "open;' },
]);

export const formatterFixtures: readonly FormatterFixture[] = Object.freeze([
  {
    name: "canonical let spacing",
    source: "let value=1;",
    real: "let value = 1;\n",
    realFix: "let value = 1;\n",
  },
  {
    name: "missing lambda block and terminator",
    source: 'let main=()=>print "hello world"',
    real: 'let main = () => print "hello world"\n',
    realFix: 'let main = () => {\n  print "hello world"\n};\n',
  },
  {
    name: "block indentation",
    source: "let main=()=>{let x=1;x+1};",
    real: "let main = () => {\n  let x = 1;\n  x + 1\n};\n",
    realFix: "let main = () => {\n  let x = 1;\n  x + 1\n};\n",
  },
  {
    name: "comment contents",
    source: "// keep me\nlet value=1;",
    real: "// keep me\nlet value = 1;\n",
    realFix: "// keep me\nlet value = 1;\n",
  },
]);
