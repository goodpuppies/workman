//! WON reader and writer written from markdown/won.md alone, without consulting
//! the WM implementation. Values borrow from an arena; numbers keep their spelling.
const std = @import("std");
const Allocator = std.mem.Allocator;

pub const typed = @import("typed.zig");

pub const Field = struct { key: []const u8, value: Value };

pub const Tag = struct {
    name: []const u8,
    attributes: []const Field = &.{},
    payload: *const Value = &null_value,
};

pub const Value = union(enum) {
    null,
    boolean: bool,
    /// The exact token spelling; conversion is the caller's choice.
    number: []const u8,
    /// Valid UTF-8 after unescaping.
    text: []const u8,
    blob: []const u8,
    list: []const Value,
    /// Field order is preserved; keys are unique.
    record: []const Field,
    tag: Tag,

    /// Field lookup on a record, in the style of `std.json.ObjectMap.get`.
    pub fn get(self: Value, key: []const u8) ?Value {
        if (self != .record) return null;
        for (self.record) |field| {
            if (std.mem.eql(u8, field.key, key)) return field.value;
        }
        return null;
    }
};

const null_value: Value = .null;

pub const max_depth = 128;

pub const Diagnostic = struct { offset: usize = 0, message: []const u8 = "" };

pub const ParseError = error{ Syntax, OutOfMemory };

/// Parse one document. All allocations go to `arena`; strings without escapes
/// still get copied so the result does not borrow `source`.
pub fn parse(arena: Allocator, source: []const u8, diagnostic: *Diagnostic) ParseError!Value {
    var p: Parser = .{ .src = source, .arena = arena, .diagnostic = diagnostic };
    const result = try p.value(0);
    try p.skip();
    if (p.pos != p.src.len) return p.fail(p.pos, "unexpected trailing input");
    return result;
}

const Parser = struct {
    src: []const u8,
    pos: usize = 0,
    arena: Allocator,
    diagnostic: *Diagnostic,

    fn fail(p: *Parser, offset: usize, message: []const u8) error{Syntax} {
        p.diagnostic.* = .{ .offset = offset, .message = message };
        return error.Syntax;
    }

    fn peek(p: *Parser) ?u8 {
        return if (p.pos < p.src.len) p.src[p.pos] else null;
    }

    fn startsWith(p: *Parser, prefix: []const u8) bool {
        return std.mem.startsWith(u8, p.src[p.pos..], prefix);
    }

    /// Whitespace, commas, `//` comments, and nested `/* */` comments.
    fn skip(p: *Parser) error{Syntax}!void {
        while (p.peek()) |c| {
            if (c == ' ' or c == '\t' or c == '\r' or c == '\n' or c == ',') {
                p.pos += 1;
            } else if (p.startsWith("//")) {
                while (p.peek()) |d| : (p.pos += 1) if (d == '\n' or d == '\r') break;
            } else if (p.startsWith("/*")) {
                const start = p.pos;
                var depth: usize = 0;
                while (true) {
                    if (p.pos >= p.src.len) return p.fail(start, "unterminated block comment");
                    if (p.startsWith("/*")) {
                        depth += 1;
                        p.pos += 2;
                    } else if (p.startsWith("*/")) {
                        depth -= 1;
                        p.pos += 2;
                        if (depth == 0) break;
                    } else p.pos += 1;
                }
            } else return;
        }
    }

    fn value(p: *Parser, depth: usize) ParseError!Value {
        try p.skip();
        if (depth > max_depth) return p.fail(p.pos, "maximum nesting depth exceeded");
        const c = p.peek() orelse return p.fail(p.pos, "expected value");
        if (c == '"') return .{ .text = try p.text() };
        if (p.startsWith("x\"")) return .{ .blob = try p.blob() };
        if (c == '[') return .{ .list = try p.list(depth) };
        if (c == '{') return .{ .record = try p.record(depth) };
        if (c == '-' or std.ascii.isDigit(c)) return .{ .number = try p.number() };
        const start = p.pos;
        const word = p.name() orelse return p.fail(start, "expected value");
        if (std.mem.eql(u8, word, "null")) return .null;
        if (std.mem.eql(u8, word, "true")) return .{ .boolean = true };
        if (std.mem.eql(u8, word, "false")) return .{ .boolean = false };
        return .{ .tag = try p.tag(word, depth) };
    }

    fn name(p: *Parser) ?[]const u8 {
        const start = p.pos;
        const first = p.peek() orelse return null;
        if (!isNameStart(first)) return null;
        while (p.peek()) |c| : (p.pos += 1) if (!isNameChar(c)) break;
        return p.src[start..p.pos];
    }

    /// Attribute and payload delimiters must touch the name or `>`.
    fn tag(p: *Parser, word: []const u8, depth: usize) ParseError!Tag {
        var result: Tag = .{ .name = try p.arena.dupe(u8, word) };
        if (p.peek() == '<') {
            const at = p.pos;
            p.pos += 1;
            result.attributes = try p.fields(depth, '>');
            if (result.attributes.len == 0) return p.fail(at, "omit empty tag attributes");
        }
        const payload = try p.arena.create(Value);
        payload.* = switch (p.peek() orelse 0) {
            '[' => .{ .list = try p.list(depth) },
            '{' => .{ .record = try p.record(depth) },
            '(' => blk: {
                const at = p.pos;
                p.pos += 1;
                const inner = try p.value(depth + 1);
                switch (inner) {
                    .null => return p.fail(at, "omit null tag payload"),
                    .list => return p.fail(at, "list tag payload must use []"),
                    .record => return p.fail(at, "record tag payload must use {}"),
                    else => {},
                }
                try p.skip();
                if (p.peek() != ')') return p.fail(p.pos, "expected )");
                p.pos += 1;
                break :blk inner;
            },
            else => .null,
        };
        result.payload = payload;
        return result;
    }

    /// After an entry: the container closes, or at least one separator follows.
    fn separated(p: *Parser, close: u8) error{Syntax}!void {
        const end = p.pos;
        try p.skip();
        if (p.peek() != close and p.pos == end) return p.fail(p.pos, "expected whitespace between values or fields");
    }

    fn list(p: *Parser, depth: usize) ParseError![]const Value {
        p.pos += 1;
        var items: std.ArrayList(Value) = .empty;
        while (true) {
            try p.skip();
            if (p.peek() == ']') {
                p.pos += 1;
                return items.toOwnedSlice(p.arena);
            }
            try items.append(p.arena, try p.value(depth + 1));
            try p.separated(']');
        }
    }

    fn record(p: *Parser, depth: usize) ParseError![]const Field {
        p.pos += 1;
        return p.fields(depth, '}');
    }

    /// Record (`}`) and attribute (`>`) fields, after the opening delimiter.
    fn fields(p: *Parser, depth: usize, close: u8) ParseError![]const Field {
        var items: std.ArrayList(Field) = .empty;
        while (true) {
            try p.skip();
            if (p.peek() == close) {
                p.pos += 1;
                return items.toOwnedSlice(p.arena);
            }
            const at = p.pos;
            const field_key = try p.key();
            for (items.items) |field| {
                if (std.mem.eql(u8, field.key, field_key)) return p.fail(at, "duplicate field");
            }
            try p.skip();
            if (p.peek() != '=') return p.fail(p.pos, "expected =");
            p.pos += 1;
            try items.append(p.arena, .{ .key = field_key, .value = try p.value(depth + 1) });
            try p.separated(close);
        }
    }

    fn key(p: *Parser) ParseError![]const u8 {
        const at = p.pos;
        if (p.peek() == '"') {
            const quoted = try p.text();
            if (isIdentifier(quoted)) return p.fail(at, "identifier keys must be bare");
            return quoted;
        }
        const word = p.name() orelse return p.fail(at, "expected name");
        return p.arena.dupe(u8, word);
    }

    fn number(p: *Parser) error{Syntax}![]const u8 {
        const start = p.pos;
        if (p.peek() == '-') p.pos += 1;
        const whole = p.digits();
        if (whole == 0 or (whole > 1 and p.src[p.pos - whole] == '0')) return p.fail(start, "invalid number");
        if (p.peek() == '.') {
            p.pos += 1;
            if (p.digits() == 0) return p.fail(p.pos, "expected digit");
        }
        if (p.peek() == 'e' or p.peek() == 'E') {
            p.pos += 1;
            if (p.peek() == '+' or p.peek() == '-') p.pos += 1;
            if (p.digits() == 0) return p.fail(p.pos, "expected digit");
        }
        return p.src[start..p.pos];
    }

    fn digits(p: *Parser) usize {
        const start = p.pos;
        while (p.peek()) |c| : (p.pos += 1) if (!std.ascii.isDigit(c)) break;
        return p.pos - start;
    }

    fn text(p: *Parser) ParseError![]const u8 {
        const start = p.pos;
        p.pos += 1; // "
        var out: std.ArrayList(u8) = .empty;
        while (true) {
            const c = p.peek() orelse return p.fail(start, "unterminated quoted value");
            if (c == '"') break;
            if (c == '\\') {
                const escape = if (p.pos + 1 < p.src.len) p.src[p.pos + 1] else return p.fail(p.pos, "unknown escape");
                const decoded: u8 = switch (escape) {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    '"' => '"',
                    '\\' => '\\',
                    'x' => blk: {
                        const byte = hexPair(p.src[@min(p.pos + 2, p.src.len)..]) orelse
                            return p.fail(p.pos, "expected two hex digits after \\x");
                        if (!isControl(byte) or byte == '\n' or byte == '\r' or byte == '\t')
                            return p.fail(p.pos, "use literal UTF-8 or the named text escape");
                        p.pos += 2;
                        break :blk byte;
                    },
                    else => return p.fail(p.pos, "unknown escape"),
                };
                p.pos += 2;
                try out.append(p.arena, decoded);
            } else {
                if (isControl(c)) return p.fail(p.pos, "control byte must be escaped");
                try out.append(p.arena, c);
                p.pos += 1;
            }
        }
        p.pos += 1;
        if (!std.unicode.utf8ValidateSlice(out.items)) return p.fail(start, "text is not valid UTF-8");
        return out.toOwnedSlice(p.arena);
    }

    fn blob(p: *Parser) ParseError![]const u8 {
        p.pos += 2; // x"
        var out: std.ArrayList(u8) = .empty;
        while (p.peek() != '"') {
            if (p.pos + 1 >= p.src.len) return p.fail(p.pos, "unterminated hex blob");
            try out.append(p.arena, hexPair(p.src[p.pos..]) orelse
                return p.fail(p.pos, "hex blob requires pairs of hex digits"));
            p.pos += 2;
        }
        p.pos += 1;
        return out.toOwnedSlice(p.arena);
    }
};

fn isNameStart(c: u8) bool {
    return std.ascii.isAlphabetic(c) or c == '_';
}

fn isNameChar(c: u8) bool {
    return isNameStart(c) or std.ascii.isDigit(c);
}

pub fn isIdentifier(s: []const u8) bool {
    if (s.len == 0 or !isNameStart(s[0])) return false;
    for (s[1..]) |c| if (!isNameChar(c)) return false;
    return true;
}

fn isControl(c: u8) bool {
    return c < 0x20 or c == 0x7f;
}

fn hexDigit(c: u8) ?u8 {
    return switch (c) {
        '0'...'9' => c - '0',
        'a'...'f' => c - 'a' + 10,
        else => null,
    };
}

fn hexPair(s: []const u8) ?u8 {
    if (s.len < 2) return null;
    return (hexDigit(s[0]) orelse return null) * 16 + (hexDigit(s[1]) orelse return null);
}

/// True when `s` is a complete token under the number grammar.
pub fn isNumber(s: []const u8) bool {
    var diagnostic: Diagnostic = .{};
    var p: Parser = .{ .src = s, .arena = undefined, .diagnostic = &diagnostic };
    _ = p.number() catch return false;
    return p.pos == s.len;
}

pub const WriteError = error{InvalidValue} || std.Io.Writer.Error;

/// Canonical output: single spaces, bare identifier keys, lowercase hex.
/// Programmatic values are checked against the format's invariants first.
pub fn write(w: *std.Io.Writer, v: Value) WriteError!void {
    try validate(v, 0);
    try render(w, v);
}

fn validate(v: Value, depth: usize) error{InvalidValue}!void {
    if (depth > max_depth) return error.InvalidValue;
    switch (v) {
        .null, .boolean, .blob => {},
        .number => |s| if (!isNumber(s)) return error.InvalidValue,
        .text => |s| if (!std.unicode.utf8ValidateSlice(s)) return error.InvalidValue,
        .list => |items| for (items) |item| try validate(item, depth + 1),
        .record => |entries| try validateFields(entries, depth),
        .tag => |t| {
            if (!isIdentifier(t.name) or std.mem.eql(u8, t.name, "null") or
                std.mem.eql(u8, t.name, "true") or std.mem.eql(u8, t.name, "false")) return error.InvalidValue;
            try validateFields(t.attributes, depth);
            try validate(t.payload.*, depth + 1);
        },
    }
}

fn validateFields(entries: []const Field, depth: usize) error{InvalidValue}!void {
    for (entries, 0..) |field, i| {
        if (!std.unicode.utf8ValidateSlice(field.key)) return error.InvalidValue;
        for (entries[0..i]) |earlier| if (std.mem.eql(u8, earlier.key, field.key)) return error.InvalidValue;
        try validate(field.value, depth + 1);
    }
}

fn render(w: *std.Io.Writer, v: Value) std.Io.Writer.Error!void {
    switch (v) {
        .null => try w.writeAll("null"),
        .boolean => |b| try w.writeAll(if (b) "true" else "false"),
        .number => |s| try w.writeAll(s),
        .text => |s| try quote(w, s),
        .blob => |bytes| {
            try w.writeAll("x\"");
            for (bytes) |b| try w.print("{x:0>2}", .{b});
            try w.writeByte('"');
        },
        .list => |items| {
            try w.writeByte('[');
            for (items, 0..) |item, i| {
                if (i > 0) try w.writeByte(' ');
                try render(w, item);
            }
            try w.writeByte(']');
        },
        .record => |entries| {
            try w.writeByte('{');
            try renderFields(w, entries);
            try w.writeByte('}');
        },
        .tag => |t| {
            try w.writeAll(t.name);
            if (t.attributes.len > 0) {
                try w.writeByte('<');
                try renderFields(w, t.attributes);
                try w.writeByte('>');
            }
            switch (t.payload.*) {
                .null => {},
                .list, .record => try render(w, t.payload.*),
                else => {
                    try w.writeByte('(');
                    try render(w, t.payload.*);
                    try w.writeByte(')');
                },
            }
        },
    }
}

fn renderFields(w: *std.Io.Writer, entries: []const Field) std.Io.Writer.Error!void {
    for (entries, 0..) |field, i| {
        if (i > 0) try w.writeByte(' ');
        if (isIdentifier(field.key)) try w.writeAll(field.key) else try quote(w, field.key);
        try w.writeAll(" = ");
        try render(w, field.value);
    }
}

fn quote(w: *std.Io.Writer, s: []const u8) std.Io.Writer.Error!void {
    try w.writeByte('"');
    for (s) |c| switch (c) {
        '"' => try w.writeAll("\\\""),
        '\\' => try w.writeAll("\\\\"),
        '\n' => try w.writeAll("\\n"),
        '\r' => try w.writeAll("\\r"),
        '\t' => try w.writeAll("\\t"),
        else => if (isControl(c)) try w.print("\\x{x:0>2}", .{c}) else try w.writeByte(c),
    };
    try w.writeByte('"');
}

/// Parse and re-render, as the WM probe's `normalize` mode does.
pub fn normalize(gpa: Allocator, source: []const u8, diagnostic: *Diagnostic) (ParseError || WriteError)![]u8 {
    var arena: std.heap.ArenaAllocator = .init(gpa);
    defer arena.deinit();
    const v = try parse(arena.allocator(), source, diagnostic);
    var out: std.Io.Writer.Allocating = .init(gpa);
    defer out.deinit();
    try write(&out.writer, v);
    return out.toOwnedSlice();
}

fn expectNormal(source: []const u8, expected: []const u8) !void {
    var diagnostic: Diagnostic = .{};
    const out = normalize(std.testing.allocator, source, &diagnostic) catch |e| {
        std.debug.print("{s}: byte {d}: {s}\n", .{ source, diagnostic.offset, diagnostic.message });
        return e;
    };
    defer std.testing.allocator.free(out);
    try std.testing.expectEqualStrings(expected, out);
}

fn expectInvalid(source: []const u8) !void {
    var diagnostic: Diagnostic = .{};
    const out = normalize(std.testing.allocator, source, &diagnostic) catch return;
    defer std.testing.allocator.free(out);
    std.debug.print("unexpectedly accepted: {s}\n", .{source});
    return error.TestUnexpectedResult;
}

test "spec examples" {
    try expectNormal("[Ready [1 2]]", "[Ready [1 2]]");
    try expectNormal("[Ready[1 2]]", "[Ready[1 2]]");
    try expectNormal("[Ready,[1 2]]", "[Ready [1 2]]");
    try expectNormal("{a = 1, b = 2,}", "{a = 1 b = 2}");
    try expectNormal("[1E+5 -0.5e-3 1e00]", "[1E+5 -0.5e-3 1e00]");
    try expectNormal("Button<id = 1>(\"Save\")", "Button<id = 1>(\"Save\")");
    try expectNormal("/* a /* b */ c */ x\"00ff\" // end", "x\"00ff\"");
    try expectNormal("{\"two words\" = \"\\x00\\n\" null = true}", "{\"two words\" = \"\\x00\\n\" null = true}");
}

test "spec rejections" {
    for ([_][]const u8{
        "", "[1 2", "{x=1 x=2}", "[01]", "1.", "1e", "1e+", ".5", "+1", "X()", "X(null)",
        "X([1])", "X({a=1})", "X<>", "x\"FF\"", "\"\\x41\"", "\"\\q\"", "\"\xff\"", "[1true]",
        "{\"name\" = 1}", "X<id=1> (\"payload\")", "true false", "/* open",
    }) |source| try expectInvalid(source);
}

test "programmatic values are checked before writing" {
    var out: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer out.deinit();
    try std.testing.expectError(error.InvalidValue, write(&out.writer, .{ .number = "1 2" }));
    try std.testing.expectError(error.InvalidValue, write(&out.writer, .{ .tag = .{ .name = "null" } }));
    const duplicate = [_]Field{ .{ .key = "a", .value = .null }, .{ .key = "a", .value = .null } };
    try std.testing.expectError(error.InvalidValue, write(&out.writer, .{ .record = &duplicate }));
}

test {
    _ = typed;
}
