//! Runtime C reflection through Aro; no translated Zig or comptime header compilation.
const std = @import("std");
const aro = @import("aro");
const J = std.json.Value;
const A = std.mem.Allocator;
const version = "workman-c-header-extractor/1 aro-zig-0.16.0";

fn object(_: A) J {
    return .{ .object = .empty };
}
fn array(a: A) J {
    return .{ .array = std.array_list.Managed(J).init(a) };
}
fn text(s: []const u8) J {
    return .{ .string = s };
}
fn integer(n: anytype) J {
    return .{ .integer = @intCast(n) };
}
fn put(a: A, o: *J, k: []const u8, v: J) !void {
    try o.object.put(a, k, v);
}
fn tag(a: A, kind: []const u8) !J {
    var o = object(a);
    try put(a, &o, "kind", text(kind));
    return o;
}

pub fn main(init: std.process.Init) !void {
    const a = init.arena.allocator();
    const args = try init.minimal.args.toSlice(a);
    var out_buf: [4096]u8 = undefined;
    var out = std.Io.File.stdout().writer(init.io, &out_buf);
    if (args.len == 2 and std.mem.eql(u8, args[1], "--version")) {
        try out.interface.print("{s}\n", .{version});
        try out.interface.flush();
        return;
    }
    var symbols: std.StringHashMapUnmanaged(void) = .empty;
    var cc_args: std.ArrayList([]const u8) = .empty;
    try cc_args.append(a, args[0]);
    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        if (std.mem.eql(u8, args[i], "--symbol")) {
            i += 1;
            if (i == args.len) return error.MissingSymbol;
            try symbols.put(a, args[i], {});
        } else try cc_args.append(a, args[i]);
    }
    var stderr_buf: [1024]u8 = undefined;
    var stderr = std.Io.File.stderr().writer(init.io, &stderr_buf);
    var diagnostics: aro.Diagnostics = .{ .output = .{ .to_writer = .{ .mode = .no_color, .writer = &stderr.interface } } };
    var environ = try std.process.Environ.createMap(init.minimal.environ, a);
    var comp = try aro.Compilation.init(.{ .gpa = a, .arena = a, .io = init.io, .diagnostics = &diagnostics, .environ_map = &environ });
    defer comp.deinit();
    var driver: aro.Driver = .{ .comp = &comp, .diagnostics = &diagnostics, .aro_name = args[0] };
    defer driver.deinit();
    var macros: std.ArrayList(u8) = .empty;
    var discard_buf: [128]u8 = undefined;
    var discard: std.Io.Writer.Discarding = .init(&discard_buf);
    if (try driver.parseArgs(&discard.writer, &macros, cc_args.items)) return error.InvalidArguments;
    if (driver.inputs.items.len != 1) return error.ExpectedOneHeader;
    var toolchain: aro.Toolchain = .{ .driver = &driver };
    defer toolchain.deinit();
    try toolchain.discover();
    try toolchain.defineSystemIncludes();
    try comp.initSearchPath(driver.includes.items, false);
    const builtin_macros = try comp.generateBuiltinMacros(driver.system_defines);
    const command_line = try comp.addSourceFromBuffer("<command line>", macros.items);
    var pp = try aro.Preprocessor.init(&comp, .{ .base_file = driver.inputs.items[0].id });
    defer pp.deinit();
    try pp.preprocessSources(.{ .main = driver.inputs.items[0], .builtin = builtin_macros, .command_line = command_line });
    const header_token_len = pp.tokens.len;
    const header_expansion_len = pp.expansion_entries.len;
    var tree = try pp.parse();
    defer tree.deinit();
    try stderr.interface.flush();
    if (diagnostics.errors != 0) return error.InvalidHeader;
    var reflection: Reflection = .{ .a = a, .comp = &comp, .tree = &tree, .symbols = &symbols, .types = array(a), .fns = array(a), .values = array(a) };
    for (tree.root_decls.items) |index| try reflection.declaration(index);
    // Evaluate object-like macros as C expressions through Aro's parser/folder.
    var macro_names: std.ArrayList([]const u8) = .empty;
    var it = pp.defines.iterator();
    while (it.next()) |entry| {
        const name = entry.key_ptr.*;
        if (entry.value_ptr.loc.id.index == .generated or entry.value_ptr.loc.id.index == .unused) continue;
        if (std.mem.eql(u8, comp.getSource(entry.value_ptr.loc.id).path, "<builtin>")) continue;
        if (!entry.value_ptr.is_func and entry.value_ptr.tokens.len > 0 and reflection.wanted(name)) try macro_names.append(a, name);
    }
    pp.tokens.len = header_token_len;
    pp.expansion_entries.len = header_expansion_len;
    for (macro_names.items) |name| {
        const token_len = pp.tokens.len;
        const expansion_len = pp.expansion_entries.len;
        pp.tokens.len -= 1;
        const probe = try std.fmt.allocPrint(a, "\n__typeof__(({s})) __wm_macro_probe = ({s});\n", .{ name, name });
        const source = try comp.addSourceFromBuffer(try std.fmt.allocPrint(a, "<macro probe:{s}>", .{name}), probe);
        const old_output = diagnostics.output;
        const old_errors = diagnostics.errors;
        diagnostics.output = .ignore;
        const eof = try pp.preprocess(source);
        try pp.addToken(eof);
        var macro_tree = try pp.parse();
        if (diagnostics.errors == old_errors) {
            var probe_reflection = reflection;
            probe_reflection.tree = &macro_tree;
            for (macro_tree.root_decls.items) |index| {
                switch (index.get(&macro_tree)) {
                    .variable => |v| if (std.mem.eql(u8, macro_tree.tokSlice(v.name_tok), "__wm_macro_probe")) {
                        if (v.initializer) |initializer| {
                            const value = try probe_reflection.value(initializer, 0);
                            if (value != .null) {
                                var item = object(a);
                                try put(a, &item, "name", text(name));
                                try put(a, &item, "type", try reflection.desc(v.qt, 0));
                                try put(a, &item, "value", value);
                                try reflection.values.array.append(item);
                            }
                        }
                    },
                    else => {},
                }
            }
        }
        diagnostics.errors = old_errors;
        diagnostics.output = old_output;
        macro_tree.deinit();
        pp.tokens.len = token_len;
        pp.expansion_entries.len = expansion_len;
        pp.clearBuffers();
    }
    var output = object(a);
    try put(a, &output, "types", reflection.types);
    try put(a, &output, "fns", reflection.fns);
    try put(a, &output, "values", reflection.values);
    var dependencies = array(a);
    for (comp.sources.values()) |source| if (!std.mem.startsWith(u8, source.path, "<")) {
        try dependencies.array.append(text(source.path));
    };
    try put(a, &output, "dependencies", dependencies);
    try out.interface.writeAll(try std.json.Stringify.valueAlloc(a, output, .{}));
    try out.interface.writeAll("\n");
    try out.interface.flush();
}

const Reflection = struct {
    a: A,
    comp: *aro.Compilation,
    tree: *aro.Tree,
    symbols: *std.StringHashMapUnmanaged(void),
    emitted: std.StringHashMapUnmanaged(void) = .empty,
    types: J,
    fns: J,
    values: J,

    fn wanted(r: *Reflection, name: []const u8) bool {
        return !std.mem.startsWith(u8, name, "__") and (r.symbols.count() == 0 or r.symbols.contains(name));
    }
    fn declaration(r: *Reflection, index: aro.Tree.Node.Index) !void {
        switch (index.get(r.tree)) {
            .typedef => |d| {
                const name = r.tree.tokSlice(d.name_tok);
                if (r.wanted(name)) try r.typeDecl(name, d.qt);
            },
            inline .struct_decl, .union_decl, .struct_forward_decl, .union_forward_decl => |d| {
                const qt = d.container_qt;
                const record = qt.getRecord(r.comp).?;
                const name = try std.fmt.allocPrint(r.a, "{s}_{s}", .{ if (qt.is(r.comp, .@"union")) "union" else "struct", record.name.lookup(r.comp) });
                if (r.wanted(name)) try r.typeDecl(name, qt);
            },
            inline .enum_decl, .enum_forward_decl => |d| {
                const en = d.container_qt.get(r.comp, .@"enum").?;
                const name = try std.fmt.allocPrint(r.a, "enum_{s}", .{en.name.lookup(r.comp)});
                if (r.wanted(name)) try r.typeDecl(name, d.container_qt);
                if (!en.incomplete) for (en.fields) |field| {
                    const field_name = field.name.lookup(r.comp);
                    if (r.wanted(field_name)) {
                        var item = object(r.a);
                        try put(r.a, &item, "name", text(field_name));
                        try put(r.a, &item, "type", try r.desc(field.qt, 0));
                        try put(r.a, &item, "value", try r.enumValue(field.name_tok));
                        try r.values.array.append(item);
                    }
                };
            },
            .function => |d| {
                const name = r.tree.tokSlice(d.name_tok);
                if (r.wanted(name)) try r.functionDecl(name, d.qt);
            },
            .variable => |d| {
                const name = r.tree.tokSlice(d.name_tok);
                if (!r.wanted(name)) return;
                if (d.qt.get(r.comp, .pointer)) |p| if (p.child.is(r.comp, .func)) return r.functionDecl(name, p.child);
                var item = object(r.a);
                try put(r.a, &item, "name", text(name));
                try put(r.a, &item, "type", try r.desc(d.qt, 0));
                try put(r.a, &item, "value", if (d.initializer) |initializer| try r.value(initializer, 0) else .null);
                try r.values.array.append(item);
            },
            else => {},
        }
    }
    fn enumValue(r: *Reflection, token: u32) !J {
        for (0..r.tree.nodes.len) |i| {
            const index: aro.Tree.Node.Index = @enumFromInt(i);
            switch (index.get(r.tree)) {
                .enum_field => |field| if (field.name_tok == token) {
                    if (r.tree.value_map.get(index)) |v| return r.scalar(v, field.qt);
                    if (field.init) |initializer| return r.value(initializer, 0);
                },
                else => {},
            }
        }
        return .null;
    }
    fn typeDecl(r: *Reflection, name: []const u8, qt: aro.QualType) !void {
        if (r.emitted.contains(name)) return;
        try r.emitted.put(r.a, name, {});
        var item = object(r.a);
        try put(r.a, &item, "name", text(name));
        if (qt.is(r.comp, .@"union")) return error.UnionTypesNotSupported;
        if (qt.getRecord(r.comp)) |record| {
            try put(r.a, &item, "kind", text("struct"));
            try put(r.a, &item, "size", integer(if (record.layout) |layout| layout.size_bits / 8 else 0));
            try put(r.a, &item, "align", integer(if (record.layout) |layout| layout.pointer_alignment_bits / 8 else 1));
            try put(r.a, &item, "opaque", .{ .bool = record.layout == null or record.fields.len == 0 });
            var fields = array(r.a);
            for (record.fields) |field| {
                if (field.name == .empty) return error.AnonymousFieldsNotSupported;
                if (field.bit_width.unpack() != null) return error.BitFieldsNotSupported;
                var f = object(r.a);
                try put(r.a, &f, "name", text(field.name.lookup(r.comp)));
                try put(r.a, &f, "type", try r.desc(field.qt, 0));
                try put(r.a, &f, "offset", integer(field.layout.offset_bits / 8));
                try fields.array.append(f);
            }
            try put(r.a, &item, "fields", fields);
        } else if (qt.get(r.comp, .@"enum")) |en| {
            try put(r.a, &item, "kind", text("alias"));
            try put(r.a, &item, "target", if (en.tag) |backing| try r.desc(backing, 0) else try tag(r.a, "unknown"));
        } else {
            try put(r.a, &item, "kind", text("alias"));
            try put(r.a, &item, "target", try r.desc(qt, 0));
        }
        try r.types.array.append(item);
    }
    fn functionDecl(r: *Reflection, name: []const u8, qt: aro.QualType) !void {
        const f = qt.get(r.comp, .func) orelse return error.ExpectedFunction;
        if (f.kind != .normal) return error.VariadicFunctionsNotSupported;
        var item = object(r.a);
        try put(r.a, &item, "name", text(name));
        var params = array(r.a);
        for (f.params) |param| try params.array.append(try r.desc(param.qt, 0));
        try put(r.a, &item, "params", params);
        try put(r.a, &item, "return", try r.desc(f.return_type, 0));
        try r.fns.array.append(item);
    }
    fn desc(r: *Reflection, qt: aro.QualType, depth: usize) anyerror!J {
        if (depth > 32 or qt.isInvalid()) return tag(r.a, "unknown");
        return switch (qt.base(r.comp).type) {
            .void => tag(r.a, "void"),
            .bool => tag(r.a, "bool"),
            .int, .bit_int => blk: {
                var item = try tag(r.a, "int");
                const bits = qt.bitSizeof(r.comp);
                const signed = qt.signedness(r.comp) == .signed;
                const name = if (qt.get(r.comp, .int)) |ty| switch (ty) {
                    .char, .schar => "c_char",
                    .uchar => "u8",
                    .int => "c_int",
                    .uint => "c_uint",
                    .long => "c_long",
                    .ulong => "c_ulong",
                    .long_long => "c_longlong",
                    .ulong_long => "c_ulonglong",
                    else => try std.fmt.allocPrint(r.a, "{s}{d}", .{ if (signed) "i" else "u", bits }),
                } else try std.fmt.allocPrint(r.a, "{s}{d}", .{ if (signed) "i" else "u", bits });
                try put(r.a, &item, "bits", integer(bits));
                try put(r.a, &item, "signed", .{ .bool = signed });
                try put(r.a, &item, "name", text(name));
                break :blk item;
            },
            .float => |f| blk: {
                var item = try tag(r.a, "float");
                try put(r.a, &item, "bits", integer(f.bits(r.comp)));
                try put(r.a, &item, "name", text(try std.fmt.allocPrint(r.a, "f{d}", .{f.bits(r.comp)})));
                break :blk item;
            },
            .pointer => |p| blk: {
                var item = try tag(r.a, "pointer");
                try put(r.a, &item, "child", try r.desc(p.child, depth + 1));
                try put(r.a, &item, "const", .{ .bool = p.child.@"const" });
                break :blk item;
            },
            .array => |arr| blk: {
                var item = try tag(r.a, "array");
                const len: u64 = switch (arr.len) {
                    .fixed, .static => |n| n,
                    else => 0,
                };
                try put(r.a, &item, "length", integer(len));
                try put(r.a, &item, "child", try r.desc(arr.elem, depth + 1));
                break :blk item;
            },
            .@"union" => return error.UnionTypesNotSupported,
            .@"struct" => |record| blk: {
                var item = try tag(r.a, "named");
                try put(r.a, &item, "name", text(try std.fmt.allocPrint(r.a, "cimport.{s}_{s}", .{ if (qt.is(r.comp, .@"union")) "union" else "struct", record.name.lookup(r.comp) })));
                break :blk item;
            },
            .@"enum" => |en| if (en.tag) |backing| r.desc(backing, depth + 1) else tag(r.a, "unknown"),
            else => tag(r.a, "unknown"),
        };
    }
    fn scalar(r: *Reflection, v: aro.Value, qt: aro.QualType) !J {
        if (qt.is(r.comp, .bool)) return .{ .bool = v.toBool(r.comp) };
        if (v.toInt(i64, r.comp)) |n| return integer(n);
        if (v.toInt(u64, r.comp)) |n| return .{ .number_string = try std.fmt.allocPrint(r.a, "{d}", .{n}) };
        if (v.is(.float, r.comp)) return .{ .float = v.toFloat(f64, r.comp) };
        return .null;
    }
    fn value(r: *Reflection, index: aro.Tree.Node.Index, depth: usize) anyerror!J {
        if (depth > 32) return .null;
        if (r.tree.value_map.get(index)) |v| {
            const result = try r.scalar(v, index.qt(r.tree));
            if (result != .null) return result;
        }
        return switch (index.get(r.tree)) {
            .cast => |c| r.value(c.operand, depth + 1),
            .paren_expr => |p| r.value(p.operand, depth + 1),
            .compound_literal_expr => |c| r.value(c.initializer, depth + 1),
            .struct_init_expr => |s| blk: {
                const record = s.container_qt.getRecord(r.comp).?;
                var item = object(r.a);
                for (s.items, 0..) |child, i| try put(r.a, &item, record.fields[i].name.lookup(r.comp), try r.value(child, depth + 1));
                break :blk item;
            },
            .array_init_expr => |arr| blk: {
                var item = array(r.a);
                for (arr.items) |child| try item.array.append(try r.value(child, depth + 1));
                break :blk item;
            },
            .default_init_expr => integer(0),
            else => .null,
        };
    }
};
