import { assertEquals, assertStrictEquals } from "@std/assert";
import { compileLibraryFile } from "../src/compiler.ts";

type Variant = { name: string; args: unknown[] };
type Position = { index: number; line: number; col: number };
type Mark = {
  id: Variant;
  problem: Variant;
  anchor: Variant;
  affectedSpan: { start: Variant; end: Variant };
  recovery: Variant;
};
type Token = {
  kind: Variant;
  span: { startPos: Position; endPos: Position };
  mateIdx: Variant;
  marks: Variant;
  leadingTrivia: Variant;
};

function list<T>(value: Variant): T[] {
  const items: T[] = [];
  while (value.name === "Cons") {
    const [head, tail] = value.args[0] as [T, Variant];
    items.push(head);
    value = tail;
  }
  assertEquals(value.name, "Nil");
  return items;
}

Deno.test("frontend v3 lexer retains damaged lexemes and localized recovery marks", async () => {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(
      path,
      await compileLibraryFile(
        new URL("../tooling/frontend-v3/lexer.wm", import.meta.url).pathname,
      ),
    );
    const { lex } = await import(`file://${path}`) as {
      lex: (source: string) => { tokens: Variant; marks: Variant };
    };
    const read = (source: string) => {
      const document = lex(source);
      const tokens = list<Token>(document.tokens);
      const marks = list<Mark>(document.marks);
      assertEquals(tokens.at(-1)?.kind.name, "EndOfFileToken");
      assertEquals(tokens.at(-1)?.span.endPos.index, source.length);
      assertEquals(marks.map((mark) => mark.id.args[0]), marks.map((_, i) => i));
      const attached = tokens.flatMap((token) => [
        ...list<{ marks: Variant }>(token.leadingTrivia).flatMap((item) => list<Mark>(item.marks)),
        ...list<Mark>(token.marks),
      ]);
      assertEquals(attached.length, marks.length);
      attached.forEach((mark, i) => assertStrictEquals(mark, marks[i]));
      tokens.forEach((token, index) => {
        if (token.mateIdx.name === "Mate") {
          const other = token.mateIdx.args[0] as number;
          assertEquals(tokens[other].mateIdx.name, "Mate");
          assertEquals(tokens[other].mateIdx.args[0], index);
        }
      });
      let cursor = 0;
      let reconstructed = "";
      for (const token of tokens) {
        const trivia = list<{ kind: Variant; text: string; span: Token["span"] }>(
          token.leadingTrivia,
        );
        for (const item of trivia) {
          assertEquals(item.span.startPos.index, cursor);
          assertEquals(item.text, source.slice(cursor, item.span.endPos.index));
          reconstructed += item.text;
          cursor = item.span.endPos.index;
        }
        assertEquals(token.span.startPos.index, cursor);
        reconstructed += source.slice(cursor, token.span.endPos.index);
        cursor = token.span.endPos.index;
      }
      assertEquals(reconstructed, source);
      return { tokens, marks };
    };

    for (const source of ["", " \t\n", "hello 42", "-- comment\n// comment", '"ok\\n\\t\\\\\\""']) {
      assertEquals(read(source).marks.length, 0);
    }
    // All accepted literal modes are recognized, including SML gaps and escapes.
    for (
      const source of [
        "`text`",
        "`// text }`",
        "`${value}`",
        "'c'",
        '"\\065"',
        '"\\u0041"',
        '"\\^A"',
        '"hello\\\n  \\world"',
      ]
    ) {
      assertEquals(read(source).marks.length, 0);
    }
    assertEquals(read('"\\a\\b\\v\\f\\r"').marks.length, 0);
    for (const source of ['"`"', "-- `text`", "// `${value}`"]) {
      assertEquals(read(source).marks.length, 0);
    }
    const damaged = read('&"\\q\\z"§');
    assertEquals(damaged.marks.map((mark) => mark.problem.name), [
      "UnknownCharacter",
      "InvalidEscape",
      "InvalidEscape",
      "UnknownCharacter",
    ]);
    assertEquals(
      damaged.marks.map((mark) => [
        mark.anchor.args[0],
        mark.affectedSpan.start.args[0],
        mark.affectedSpan.end.args[0],
      ]),
      [[0, 0, 1], [2, 2, 4], [4, 4, 6], [7, 7, 8]],
    );

    const unclosed = read('"oops\r\nnext');
    assertEquals(unclosed.marks.map((mark) => mark.problem.name), ["UnterminatedQuotedString"]);
    assertEquals(unclosed.marks[0].anchor.args[0], 5);
    assertEquals(unclosed.tokens[1].span.startPos, { index: 7, line: 1, col: 0 });
    assertEquals(read('"\\q').marks.map((mark) => mark.problem.name), [
      "InvalidEscape",
      "UnterminatedQuotedString",
    ]);

    const quoted = (body: string, quote = '"') => quote + body + quote;
    for (
      const body of [
        "\\^@",
        "\\^_",
        "\\000",
        "\\065",
        "\\999",
        "\\u0000",
        "\\u0041",
        "\\uFFFF",
        "\\u{0}",
        "\\u{1f600}",
        "\\u{10FFFF}",
        "\\'",
        '\\"',
        "\\\\",
      ]
    ) {
      assertEquals(read(quoted(body)).marks.length, 0);
      const character = read(quoted(body, "'"));
      assertEquals(character.marks.length, 0);
      assertEquals(character.tokens[0].kind.name, "CharacterToken");
    }
    for (const body of ["c", "😀", "\\ \\" + "c", "c\\\n  \\"]) {
      assertEquals(read(quoted(body, "'")).marks.length, 0);
    }
    for (
      const [body, count] of [["", 0], ["ab", 2], ["e\u0301", 2], ["\\u0061\\u0062", 2], [
        "\\ \\",
        0,
      ]] as const
    ) {
      const { marks } = read(quoted(body, "'"));
      assertEquals(marks.map((mark) => mark.problem.name), ["InvalidCharacterLength"]);
      assertEquals(marks[0].problem.args[0], count);
    }
    for (
      const body of [
        "\\q",
        "\\12",
        "\\u12Z",
        "\\^a",
        "\\uD800",
        "\\uDFFF",
        "\\u{}",
        "\\u{110000}",
        "\\u{D800}",
        "\\u{1234567}",
        "\\u{41",
        "\\\tnoGapCloser",
      ]
    ) {
      assertEquals(read(quoted(body)).marks.map((mark) => mark.problem.name), ["InvalidEscape"]);
      // Escape damage suppresses a secondary character-length diagnosis.
      assertEquals(read(quoted(body, "'")).marks.map((mark) => mark.problem.name), [
        "InvalidEscape",
      ]);
    }
    for (const body of ["\uD800", "\uDC00"]) {
      assertEquals(read(quoted(body)).marks.map((mark) => mark.problem.name), [
        "InvalidUnicodeScalar",
      ]);
      assertEquals(read(quoted(body, "'")).marks.map((mark) => mark.problem.name), [
        "InvalidUnicodeScalar",
      ]);
    }
    assertEquals(read(quoted("\\uD83D\\uDE00", "'")).marks.map((mark) => mark.problem.name), [
      "InvalidEscape",
      "InvalidEscape",
    ]);
    const shortEscape = read(quoted("\\u12Z"));
    assertEquals(shortEscape.marks[0].affectedSpan.start.args[0], 1);
    assertEquals(shortEscape.marks[0].affectedSpan.end.args[0], 5);
    assertEquals(read("'\\").marks.map((mark) => mark.problem.name), [
      "InvalidEscape",
      "UnterminatedCharacter",
    ]);
    assertEquals(read("'oops\nnext").marks.map((mark) => mark.problem.name), [
      "UnterminatedCharacter",
    ]);
    for (const newline of ["\r", "\n", "\r\n"]) {
      const gap = read(quoted("a\\" + newline + "  \\b") + " x");
      assertEquals(gap.marks.length, 0);
      assertEquals(gap.tokens[1].span.startPos.line, 1);
    }

    const tick = String.fromCharCode(96);
    const interpolation = "$" + "{";
    const template = tick + "hello " + interpolation + "name}" + tick;
    const templateDoc = read(template);
    assertEquals(templateDoc.marks.length, 0);
    assertEquals(templateDoc.tokens.slice(0, -1).map((token) => token.kind.name), [
      "MultilineStringStartToken",
      "MultilineStringTextToken",
      "InterpolationStartToken",
      "LowerIdentifierToken",
      "InterpolationEndToken",
      "MultilineStringEndToken",
    ]);
    assertEquals(templateDoc.tokens.slice(0, -1).map((token) => token.mateIdx.args[0]), [
      5,
      undefined,
      4,
      undefined,
      2,
      0,
    ]);
    for (
      const body of [
        "",
        "// -- /* */ }",
        "\\" + tick + " \\$" + "{notCode}",
        "a\nb\r\nc",
        interpolation + ".{x = [1], text = \"}\", char = '}'} }",
        interpolation + " // }\n x }",
        interpolation + " /* } */ x }",
        interpolation + tick + "inner " + interpolation + "x}" + tick + "}",
      ]
    ) {
      assertEquals(read(tick + body + tick).marks.length, 0);
    }
    const unclosedTemplate = read(tick + "a " + interpolation + "x");
    assertEquals(unclosedTemplate.marks.map((mark) => mark.problem.name), [
      "UnterminatedMultilineString",
      "UnterminatedInterpolation",
    ]);
    assertEquals(unclosedTemplate.marks.map((mark) => mark.anchor.args[0]), [0, 3]);
    assertEquals(unclosedTemplate.marks.map((mark) => mark.affectedSpan.end.args[0]), [6, 6]);
    assertEquals(read(tick).marks.map((mark) => mark.problem.name), [
      "UnterminatedMultilineString",
    ]);
    assertEquals(read(tick + "\\q" + tick).marks.map((mark) => mark.problem.name), [
      "InvalidEscape",
    ]);
    const scope = read(tick + interpolation + "(x}" + tick + ")");
    assertEquals(scope.marks.map((mark) => mark.problem.name), [
      "UnmatchedDelimiter",
      "UnmatchedDelimiter",
    ]);
    assertEquals(scope.tokens[2].mateIdx.name, "NoMate");
    assertEquals(scope.tokens[6].mateIdx.name, "NoMate");
    assertEquals(
      read((tick + interpolation).repeat(500) + "x" + ("}" + tick).repeat(500)).marks.length,
      0,
    );
    assertEquals(read(tick + "x".repeat(30000) + tick).marks.length, 0);
    for (
      const source of [
        template,
        quoted("\\u{1F600}"),
        quoted("\\^A", "'"),
        quoted("a\\\r\n  \\b"),
        tick + interpolation + ".{text = " + tick + "nested" + tick + "}} tail" + tick,
      ]
    ) {
      for (let end = 0; end <= source.length; end++) read(source.slice(0, end));
    }
    const editable = tick + interpolation + '.{x = [1], text = "a"}' + "} tail" + tick;
    for (let index = 0; index < editable.length; index++) {
      read(editable.slice(0, index) + editable.slice(index + 1));
      for (const insert of [tick, "}", "{", "[", "]", "'", '"', "\\", "\n"]) {
        read(editable.slice(0, index) + insert + editable.slice(index));
      }
    }

    assertEquals(read("x ".repeat(10000)).tokens.length, 10001);
    assertEquals(read("x".repeat(20000)).tokens.length, 2);

    const unicode = read("🐾x");
    assertEquals(unicode.tokens.length, 3);
    assertEquals(unicode.marks.length, 1);
    assertEquals(unicode.marks[0].affectedSpan.end.args[0], 2);
    assertEquals(unicode.tokens[1].span.startPos.col, 2);

    const primed = read("x' x'' value'next Ctor' let' Module.value' 'a'");
    assertEquals(primed.marks.length, 0);
    assertEquals(primed.tokens.slice(0, -1).map((token) => token.kind.name), [
      "LowerIdentifierToken",
      "LowerIdentifierToken",
      "LowerIdentifierToken",
      "UpperIdentifierToken",
      "LowerIdentifierToken",
      "UpperIdentifierToken",
      "PunctuationToken",
      "LowerIdentifierToken",
      "CharacterToken",
    ]);

    const words = read("let true false void match Var Result _ _foo letdown");
    assertEquals(words.tokens.slice(0, -1).map((token) => token.kind.name), [
      "LowerIdentifierToken",
      "LowerIdentifierToken",
      "LowerIdentifierToken",
      "LowerIdentifierToken",
      "LowerIdentifierToken",
      "UpperIdentifierToken",
      "UpperIdentifierToken",
      "LowerIdentifierToken",
      "LowerIdentifierToken",
      "LowerIdentifierToken",
    ]);

    const symbols: [string, string][] = [
      ["(", "LeftParen"],
      [")", "RightParen"],
      ["{", "LeftBrace"],
      ["}", "RightBrace"],
      ["[", "LeftBracket"],
      ["]", "RightBracket"],
      ["<", "LessThan"],
      [">", "GreaterThan"],
      [",", "Comma"],
      [";", "Semicolon"],
      [":", "Colon"],
      [".", "Dot"],
      ["..", "DoubleDot"],
      [".{", "DotLeftBrace"],
      ["@", "AtSign"],
      ["=", "Equals"],
      ["=>", "FatArrow"],
      ["->", "ThinArrow"],
      ["|", "Pipe"],
      [":>", "PipeForward"],
      ["||", "BooleanOr"],
      ["&&", "BooleanAnd"],
      ["==", "Equal"],
      ["!=", "NotEqual"],
      ["<=", "LessOrEqual"],
      [">=", "GreaterOrEqual"],
      ["+", "Add"],
      ["-", "Subtract"],
      ["*", "Multiply"],
      ["/", "Divide"],
      ["%", "Remainder"],
      ["++", "Concatenate"],
      ["!", "BooleanNot"],
      ["?", "Hole"],
    ];
    for (const [spelling, name] of symbols) {
      const document = read(spelling);
      const delimiter = ["(", ")", "{", "}", "[", "]", ".{"].includes(spelling);
      assertEquals(
        document.marks.map((mark) => mark.problem.name),
        delimiter ? ["UnmatchedDelimiter"] : [],
      );
      assertEquals((document.tokens[0].kind.args[0] as Variant).name, name);
      assertEquals(document.tokens[0].span.endPos.index, spelling.length);
    }
    assertEquals(
      read("+++<==").tokens.slice(0, -1).map((token) => (token.kind.args[0] as Variant).name),
      ["Concatenate", "Add", "LessOrEqual", "Equals"],
    );

    const numbers = read("0 42 3.14 -1.5 1..2 1.field");
    assertEquals(numbers.marks.length, 0);
    assertEquals(numbers.tokens.slice(0, -1).map((token) => token.kind.name), [
      "IntegerToken",
      "IntegerToken",
      "FloatToken",
      "OperatorToken",
      "FloatToken",
      "IntegerToken",
      "PunctuationToken",
      "IntegerToken",
      "IntegerToken",
      "PunctuationToken",
      "LowerIdentifierToken",
    ]);
    for (const spelling of ["42foo", "3.14bar", "1_2"]) {
      const document = read(spelling);
      assertEquals(document.tokens.length, 2);
      assertEquals(document.marks.map((mark) => mark.problem.name), ["MalformedNumber"]);
      assertEquals(document.marks[0].affectedSpan.end.args[0], spelling.length);
    }
    for (
      const [spelling, kind] of [
        ["0x2a", "IntegerToken"],
        ["0xABCDEF", "IntegerToken"],
        ["0x1e3", "IntegerToken"],
        ["0w42", "WordToken"],
        ["0w0", "WordToken"],
        ["0wx2a", "WordToken"],
        ["0wxFF", "WordToken"],
        ["12e3", "FloatToken"],
        ["3.32E5", "FloatToken"],
        ["3e-7", "FloatToken"],
        ["3e+7", "FloatToken"],
        ["0.5E-2", "FloatToken"],
        ["001e03", "FloatToken"],
        ["0x" + "f".repeat(5000), "IntegerToken"],
        ["0wx" + "f".repeat(5000), "WordToken"],
      ]
    ) {
      const { tokens, marks } = read(spelling);
      assertEquals(marks.length, 0);
      assertEquals(tokens.length, 2);
      assertEquals(tokens[0].kind.name, kind);
      assertEquals(tokens[0].span.endPos.index, spelling.length);
    }
    for (
      const [spelling, anchor] of [
        ["0x", 2],
        ["0w", 2],
        ["0wx", 3],
        ["0xG", 2],
        ["0wxg", 3],
        ["0w9a", 3],
        ["0w1e2", 3],
        ["1e", 2],
        ["1e-", 3],
        ["1E+", 3],
        ["3.14e-", 6],
        ["1e+foo", 3],
        ["1e2foo", 3],
        ["0x2ag", 4],
        ["0x42foo", 5],
        ["0Xff", 1],
      ] as const
    ) {
      const { tokens, marks } = read(spelling);
      assertEquals(tokens.length, 2);
      assertEquals(marks.map((mark) => mark.problem.name), ["MalformedNumber"]);
      assertEquals(marks[0].anchor.args[0], anchor);
      assertEquals(marks[0].affectedSpan.start.args[0], 0);
      assertEquals(marks[0].affectedSpan.end.args[0], spelling.length);
    }
    for (
      const [source, spellings] of [
        ["-0x2a", ["-", "0x2a"]],
        ["-0w42", ["-", "0w42"]],
        ["1e-3-2", ["1e-3", "-", "2"]],
        ["1e+3+2", ["1e+3", "+", "2"]],
        ["0x2a..tail", ["0x2a", "..", "tail"]],
        ["0wxFF.field", ["0wxFF", ".", "field"]],
        ["1e2..tail", ["1e2", "..", "tail"]],
        ["1e2.field", ["1e2", ".", "field"]],
        ["1e2.0", ["1e2", ".", "0"]],
        ["4.E5", ["4", ".", "E5"]],
      ] as const
    ) {
      const { tokens, marks } = read(source);
      assertEquals(marks.length, 0);
      assertEquals(
        tokens.slice(0, -1).map((token) =>
          source.slice(
            token.span.startPos.index,
            token.span.endPos.index,
          )
        ),
        [...spellings],
      );
    }
    for (const source of ["0wxFF", "0x2a.field", "3.14e-27foo", "1e+3", "0w42"]) {
      for (let end = 0; end <= source.length; end++) read(source.slice(0, end));
    }
    for (const newline of ["\r", "\n", "\r\n"]) {
      const block = read(`/* outer${newline}/* inner */ still outer */x`);
      assertEquals(block.marks.length, 0);
      assertEquals(block.tokens.length, 2);
      assertEquals(block.tokens[0].span.startPos.line, 1);
      assertEquals(
        list<{ kind: Variant }>(block.tokens[0].leadingTrivia)[0].kind.name,
        "BlockComment",
      );
      const document = read(`-- comment${newline}x${newline}// tail`);
      assertEquals(document.tokens.length, 2);
      assertEquals(document.tokens[0].span.startPos, {
        index: 10 + newline.length,
        line: 1,
        col: 0,
      });
      assertEquals(
        list<{ kind: Variant }>(document.tokens[0].leadingTrivia).map((item) => item.kind.name),
        ["DashLineComment", "LineBreak"],
      );
      assertEquals(
        list<{ kind: Variant }>(document.tokens[1].leadingTrivia).map((item) => item.kind.name),
        ["LineBreak", "SlashLineComment"],
      );
    }

    for (const source of ["/**/", "/* // -- ` ${ [ ( */", '/* " */x', "/* a *//* b */x"]) {
      assertEquals(read(source).marks.length, 0);
    }
    const comments = read("& /* outer /* inner");
    assertEquals(comments.marks.map((mark) => mark.problem.name), [
      "UnknownCharacter",
      "UnterminatedBlockComment",
      "UnterminatedBlockComment",
    ]);
    assertEquals(comments.marks.map((mark) => mark.anchor.args[0]), [0, 2, 11]);
    assertEquals(comments.marks.slice(1).map((mark) => mark.affectedSpan.end.args[0]), [19, 19]);
    assertEquals(read("/* outer /* inner */").marks.map((mark) => mark.anchor.args[0]), [0]);
    assertEquals(read("/*".repeat(5000) + "*/".repeat(5000)).marks.length, 0);
    assertEquals(read("/*".repeat(5000)).marks.length, 5000);
    const commented = "/* outer /* inner */ tail */x";
    for (let end = 0; end <= commented.length; end++) read(commented.slice(0, end));

    const paired = read(".{[()]} ");
    assertEquals(paired.marks.length, 0);
    assertEquals(paired.tokens.slice(0, -1).map((token) => token.mateIdx.args[0]), [
      5,
      4,
      3,
      2,
      1,
      0,
    ]);

    for (
      const [source, group, side] of [
        ["{", "BraceGroup", "Open"],
        ["}", "BraceGroup", "Close"],
        ["(", "ParenGroup", "Open"],
        [")", "ParenGroup", "Close"],
        ["[", "BracketGroup", "Open"],
        ["]", "BracketGroup", "Close"],
        [".{", "BraceGroup", "Open"],
      ]
    ) {
      const { tokens, marks } = read(source);
      assertEquals(tokens[0].mateIdx.name, "NoMate");
      assertEquals(marks.length, 1);
      assertEquals(marks[0].problem.name, "UnmatchedDelimiter");
      assertEquals((marks[0].problem.args[0] as Variant[]).map((arg) => arg.name), [group, side]);
      assertEquals(marks[0].anchor.args[0], 0);
      assertEquals(marks[0].affectedSpan.start.args[0], 0);
      assertEquals(marks[0].affectedSpan.end.args[0], source.length);
      assertEquals(marks[0].recovery.name, "RecoveredWith");
      assertEquals((marks[0].recovery.args[0] as Variant).name, "RetainedUnpairedDelimiter");
    }
    const crossed = read("([)]");
    assertEquals(crossed.tokens.slice(0, -1).map((token) => token.mateIdx.name), [
      "NoMate",
      "Mate",
      "NoMate",
      "Mate",
    ]);
    assertEquals(crossed.marks.map((mark) => mark.anchor.args[0]), [0, 2]);
    const mixed = read('{ & "\\q" } ] /*');
    assertEquals(mixed.marks.map((mark) => mark.problem.name), [
      "UnknownCharacter",
      "InvalidEscape",
      "UnmatchedDelimiter",
      "UnterminatedBlockComment",
    ]);
    assertEquals(read('{ & "\\q" /*').marks.map((mark) => mark.problem.name), [
      "UnmatchedDelimiter",
      "UnknownCharacter",
      "InvalidEscape",
      "UnterminatedBlockComment",
    ]);
    assertEquals(read("{".repeat(10000)).marks.length, 10000);
    assertEquals(read('"{[(]}" /* {[(]} */').marks.length, 0);

    for (const source of ["([)]", "{(}", ")(", "[[", "[]{}()".repeat(2000)]) {
      const { tokens } = read(source);
      tokens.forEach((token, index) => {
        if (token.mateIdx.name === "Mate") {
          const other = token.mateIdx.args[0] as number;
          assertEquals(tokens[other].mateIdx.args[0], index);
        }
      });
    }
    assertEquals(read(`"${"\\q".repeat(5000)}"`).marks.length, 5000);

    // Every prefix is a realistic intermediate editor buffer, including a dangling escape.
    const source = 'let x = "a\\q"; & [42] // comment\n"unfinished\\';
    for (let end = 0; end <= source.length; end++) read(source.slice(0, end));
  } finally {
    await Deno.remove(path);
  }
});
