// C header reflection extractor for the wm-mini C FFI.
//
// A templated copy of this file is emitted per header with the HEADER and
// SYMBOLS placeholder slots substituted, then run with `zig run`. The program @cImports the
// header and uses comptime reflection to emit one JSON document describing
// the requested symbols:
//
//   {"types":[...],"fns":[...],"values":[...]}
//
// types: structs (with size/align/per-field offsets), enums (with tag values
//        and backing type), aliases (typedefs to other types).
// fns:   function types (params + return as type descriptors).
// values: constants with their comptime initializer values embedded.
//
// Zig's C layout is authoritative: struct sizes, alignment, and field offsets
// come from @sizeOf/@alignOf/@offsetOf, never computed elsewhere.

const std = @import("std");

const c = @cImport({
    @cInclude("{{HEADER}}");
});

const Io = std.Io;

const symbols = [_][]const u8{
{{SYMBOLS}}
};

// When {{SYMBOLS}} is left empty, the namespace import path enumerates every
// declaration the cImport namespace exposes.

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const allocator = init.gpa;
    if (symbols.len == 0) comptime @setEvalBranchQuota(2_000_000);

    var types = std.ArrayList(u8).empty;
    defer types.deinit(allocator);
    var fns = std.ArrayList(u8).empty;
    defer fns.deinit(allocator);
    var values = std.ArrayList(u8).empty;
    defer values.deinit(allocator);

    if (symbols.len == 0) {
        try writeJsonArray(allocator, &types, comptime allDeclNames(), emitType);
        try writeJsonArray(allocator, &fns, comptime allDeclNames(), emitFn);
        try writeJsonArray(allocator, &values, comptime allDeclNames(), emitValue);
    } else {
        try writeJsonArray(allocator, &types, symbols[0..], emitType);
        try writeJsonArray(allocator, &fns, symbols[0..], emitFn);
        try writeJsonArray(allocator, &values, symbols[0..], emitValue);
    }

    var stdout_buffer: [4096]u8 = undefined;
    var stdout_writer = Io.File.stdout().writer(io, &stdout_buffer);
    const stdout = &stdout_writer.interface;
    try stdout.writeAll("{\"types\":");
    try stdout.writeAll(types.items);
    try stdout.writeAll(",\"fns\":");
    try stdout.writeAll(fns.items);
    try stdout.writeAll(",\"values\":");
    try stdout.writeAll(values.items);
    try stdout.writeAll("}");
    try stdout.flush();
}

// Macros that aro cannot translate and that therefore reference
// @compileError decls in the cImport namespace.
const untranslatable = [_][]const u8{
    "va_start",
    "va_end",
    "va_arg",
    "va_copy",
    {{SKIP}}
};

fn allDeclNames() []const []const u8 {
    comptime {
        @setEvalBranchQuota(2_000_000);
        const decls = @typeInfo(c).@"struct".decls;
        var names: [decls.len][]const u8 = undefined;
        var count = 0;
        for (decls) |decl| {
            // Dunder decls from libc internals and known-untranslatable
            // builtin macros reference @compileError decls.
            if (std.mem.startsWith(u8, decl.name, "__")) {
                continue;
            }
            var blocked = false;
            for (untranslatable) |bad| {
                if (std.mem.eql(u8, bad, decl.name)) {
                    blocked = true;
                }
            }
            if (blocked) {
                continue;
            }
            names[count] = decl.name;
            count += 1;
        }
        const frozen = names;
        return frozen[0..count];
    }
}

fn writeJsonArray(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime names: []const []const u8,
    comptime emitFnFn: fn (std.mem.Allocator, *std.ArrayList(u8), comptime []const u8) anyerror!bool,
) !void {
    try list.append(allocator, '[');
    var first = true;
    inline for (names) |name| {
        const start_len = list.items.len;
        const wrote = try emitFnFn(allocator, list, name);
        if (wrote) {
            if (!first) {
                try list.insert(allocator, start_len, ',');
            } else {
                first = false;
            }
        }
    }
    try list.append(allocator, ']');
}

fn emitType(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime name: []const u8,
) !bool {
    const field = @field(c, name);
    if (@TypeOf(field) != type) {
        return false;
    }
    const T = field;
    const info = @typeInfo(T);
    switch (info) {
        .@"struct" => {
            try writeStruct(allocator, list, name, T);
            return true;
        },
        .@"enum" => {
            try writeEnum(allocator, list, name, T);
            return true;
        },
        else => {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "alias");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "name");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, name);
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "target");
            try list.append(allocator, ':');
            try writeTypeDesc(allocator, list, T);
            try list.append(allocator, '}');
            return true;
        },
    }
}

fn emitFn(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime name: []const u8,
) !bool {
    const field = @field(c, name);
    if (@TypeOf(field) == type) {
        return false;
    }
    const T = @TypeOf(field);
    const info = @typeInfo(T);
    if (info == .@"fn") {
        try writeFn(allocator, list, name, T);
        return true;
    }
    if (info == .pointer) {
        const child = info.pointer.child;
        if (@typeInfo(child) == .@"fn") {
            try writeFn(allocator, list, name, child);
            return true;
        }
    }
    return false;
}

// Values: constants with comptime initializer values. Scalars carry literal
// values; struct constants (raylib-style `#define COLOR CLITERAL(Color){...}`
// macros, which translate-c turns into constants) carry a field-value map;
// enums carry their backing integer. Pointers to data are recorded without a
// value (the Workman side keeps them symbolic).
fn emitValue(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime name: []const u8,
) !bool {
    const field = @field(c, name);
    if (@TypeOf(field) == type) {
        return false;
    }
    const T = @TypeOf(field);
    const info = @typeInfo(T);
    if (info == .@"fn") return false;
    if (info == .pointer or info == .optional) {
        // Data pointers (extern vars like `stdout`) stay symbolic; their
        // value is a runtime address, not a comptime constant.
        try list.append(allocator, '{');
        try writeJsonString(allocator, list, "name");
        try list.append(allocator, ':');
        try writeJsonString(allocator, list, name);
        try list.append(allocator, ',');
        try writeJsonString(allocator, list, "type");
        try list.append(allocator, ':');
        try writeTypeDesc(allocator, list, T);
        try list.append(allocator, ',');
        try writeJsonString(allocator, list, "value");
        try list.append(allocator, ':');
        try list.appendSlice(allocator, "null");
        try list.append(allocator, '}');
        return true;
    }
    if (info == .pointer and @typeInfo(info.pointer.child) == .@"fn") return false;
    try list.append(allocator, '{');
    try writeJsonString(allocator, list, "name");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, name);
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "type");
    try list.append(allocator, ':');
    try writeTypeDesc(allocator, list, T);
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "value");
    try list.append(allocator, ':');
    try writeValue(allocator, list, @field(c, name));
    try list.append(allocator, '}');
    return true;
}

fn writeValue(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime value: anytype,
) !void {
    const T = @TypeOf(value);
    const info = @typeInfo(T);
    switch (info) {
        .bool => {
            if (value) {
                try list.appendSlice(allocator, "true");
            } else {
                try list.appendSlice(allocator, "false");
            }
        },
        .int => {
            var buffer: [40]u8 = undefined;
            const slice = try std.fmt.bufPrint(&buffer, "{d}", .{value});
            try list.appendSlice(allocator, slice);
        },
        .comptime_int => {
            var buffer: [40]u8 = undefined;
            const slice = try std.fmt.bufPrint(&buffer, "{d}", .{value});
            try list.appendSlice(allocator, slice);
        },
        .float, .comptime_float => {
            var buffer: [64]u8 = undefined;
            const slice = try std.fmt.bufPrint(&buffer, "{d}", .{value});
            try list.appendSlice(allocator, slice);
        },
        .@"enum" => {
            const as_int = @intFromEnum(value);
            var buffer: [40]u8 = undefined;
            const slice = try std.fmt.bufPrint(&buffer, "{d}", .{as_int});
            try list.appendSlice(allocator, slice);
        },
        .@"struct" => {
            try list.append(allocator, '{');
            var first = true;
            inline for (info.@"struct".fields) |f| {
                if (!first) try list.append(allocator, ',');
                first = false;
                try writeJsonString(allocator, list, f.name);
                try list.append(allocator, ':');
                try writeValue(allocator, list, @field(value, f.name));
            }
            try list.append(allocator, '}');
        },
        .array => |arr| {
            try list.append(allocator, '[');
            var first = true;
            inline for (0..arr.len) |i| {
                if (!first) try list.append(allocator, ',');
                first = false;
                try writeValue(allocator, list, value[i]);
            }
            try list.append(allocator, ']');
        },
        .pointer => {
            // Data pointers (e.g. extern string constants) stay symbolic.
            try list.appendSlice(allocator, "null");
        },
        else => {
            try list.appendSlice(allocator, "null");
        },
    }
}

fn writeStruct(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime name: []const u8,
    comptime T: type,
) !void {
    const info = @typeInfo(T).@"struct";
    try list.append(allocator, '{');
    try writeJsonString(allocator, list, "kind");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, "struct");
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "name");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, name);
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "size");
    try list.append(allocator, ':');
    try writeInt(allocator, list, @sizeOf(T));
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "align");
    try list.append(allocator, ':');
    try writeInt(allocator, list, @alignOf(T));
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "fields");
    try list.append(allocator, ':');
    try list.append(allocator, '[');
    var first = true;
    inline for (info.fields) |field| {
        if (!first) try list.append(allocator, ',');
        first = false;
        try list.append(allocator, '{');
        try writeJsonString(allocator, list, "name");
        try list.append(allocator, ':');
        try writeJsonString(allocator, list, field.name);
        try list.append(allocator, ',');
        try writeJsonString(allocator, list, "type");
        try list.append(allocator, ':');
        try writeTypeDesc(allocator, list, field.type);
        try list.append(allocator, ',');
        try writeJsonString(allocator, list, "offset");
        try list.append(allocator, ':');
        try writeInt(allocator, list, @offsetOf(T, field.name));
        try list.append(allocator, '}');
    }
    try list.append(allocator, ']');
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "opaque");
    try list.append(allocator, ':');
    if (info.fields.len == 0) {
        try list.appendSlice(allocator, "true");
    } else {
        try list.appendSlice(allocator, "false");
    }
    try list.append(allocator, '}');
}

fn writeEnum(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime name: []const u8,
    comptime T: type,
) !void {
    const info = @typeInfo(T).@"enum";
    try list.append(allocator, '{');
    try writeJsonString(allocator, list, "kind");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, "enum");
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "name");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, name);
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "tags");
    try list.append(allocator, ':');
    try list.append(allocator, '[');
    var first = true;
    inline for (info.fields) |field| {
        if (!first) try list.append(allocator, ',');
        first = false;
        try list.append(allocator, '{');
        try writeJsonString(allocator, list, "name");
        try list.append(allocator, ':');
        try writeJsonString(allocator, list, field.name);
        try list.append(allocator, ',');
        try writeJsonString(allocator, list, "value");
        try list.append(allocator, ':');
        try writeInt(allocator, list, @intFromEnum(@field(T, field.name)));
        try list.append(allocator, '}');
    }
    try list.append(allocator, ']');
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "backing");
    try list.append(allocator, ':');
    try writeTypeDesc(allocator, list, info.tag_type);
    try list.append(allocator, '}');
}

fn writeFn(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime name: []const u8,
    comptime T: type,
) !void {
    const info = @typeInfo(T).@"fn";
    try list.append(allocator, '{');
    try writeJsonString(allocator, list, "name");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, name);
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "params");
    try list.append(allocator, ':');
    try list.append(allocator, '[');
    var first = true;
    inline for (info.params) |param| {
        if (!first) try list.append(allocator, ',');
        first = false;
        if (param.type) |param_type| {
            try writeTypeDesc(allocator, list, param_type);
        } else {
            try writeUnknownTypeDesc(allocator, list);
        }
    }
    try list.append(allocator, ']');
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "return");
    try list.append(allocator, ':');
    if (info.return_type) |ret| {
        try writeTypeDesc(allocator, list, ret);
    } else {
        try list.appendSlice(allocator, "null");
    }
    try list.append(allocator, '}');
}

fn writeTypeDesc(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime T: type,
) !void {
    const name = @typeName(T);
    const info = @typeInfo(T);
    switch (info) {
        .bool => {
            try writeTypeTag(allocator, list, "bool");
        },
        .void => {
            try writeTypeTag(allocator, list, "void");
        },
        .int => |int_info| {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "int");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "bits");
            try list.append(allocator, ':');
            try writeInt(allocator, list, int_info.bits);
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "signed");
            try list.append(allocator, ':');
            if (int_info.signedness == .signed) {
                try list.appendSlice(allocator, "true");
            } else {
                try list.appendSlice(allocator, "false");
            }
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "name");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, name);
            try list.append(allocator, '}');
        },
        .float => |float_info| {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "float");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "bits");
            try list.append(allocator, ':');
            try writeInt(allocator, list, float_info.bits);
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "name");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, name);
            try list.append(allocator, '}');
        },
        .pointer => |ptr_info| {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "pointer");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "child");
            try list.append(allocator, ':');
            try writeTypeDesc(allocator, list, ptr_info.child);
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "const");
            try list.append(allocator, ':');
            if (ptr_info.is_const) {
                try list.appendSlice(allocator, "true");
            } else {
                try list.appendSlice(allocator, "false");
            }
            try list.append(allocator, '}');
        },
        .optional => |opt_info| {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "optional");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "child");
            try list.append(allocator, ':');
            try writeTypeDesc(allocator, list, opt_info.child);
            try list.append(allocator, '}');
        },
        .array => |array_info| {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "array");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "length");
            try list.append(allocator, ':');
            try writeInt(allocator, list, array_info.len);
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "child");
            try list.append(allocator, ':');
            try writeTypeDesc(allocator, list, array_info.child);
            try list.append(allocator, '}');
        },
        .@"struct", .@"enum" => {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "named");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "name");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, name);
            try list.append(allocator, '}');
        },
        else => {
            try list.append(allocator, '{');
            try writeJsonString(allocator, list, "kind");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, "unknown");
            try list.append(allocator, ',');
            try writeJsonString(allocator, list, "name");
            try list.append(allocator, ':');
            try writeJsonString(allocator, list, name);
            try list.append(allocator, '}');
        },
    }
}

fn writeTypeTag(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    comptime tag: []const u8,
) !void {
    try list.append(allocator, '{');
    try writeJsonString(allocator, list, "kind");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, tag);
    try list.append(allocator, '}');
}

fn writeUnknownTypeDesc(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
) !void {
    try list.append(allocator, '{');
    try writeJsonString(allocator, list, "kind");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, "unknown");
    try list.append(allocator, ',');
    try writeJsonString(allocator, list, "name");
    try list.append(allocator, ':');
    try writeJsonString(allocator, list, "unknown");
    try list.append(allocator, '}');
}

fn writeJsonString(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    value: []const u8,
) !void {
    try list.append(allocator, '"');
    for (value) |ch| {
        switch (ch) {
            '"' => try list.appendSlice(allocator, "\\\""),
            '\\' => try list.appendSlice(allocator, "\\\\"),
            '\n' => try list.appendSlice(allocator, "\\n"),
            '\r' => try list.appendSlice(allocator, "\\r"),
            '\t' => try list.appendSlice(allocator, "\\t"),
            else => try list.append(allocator, ch),
        }
    }
    try list.append(allocator, '"');
}

fn writeInt(
    allocator: std.mem.Allocator,
    list: *std.ArrayList(u8),
    value: usize,
) !void {
    var buffer: [32]u8 = undefined;
    const slice = try std.fmt.bufPrint(&buffer, "{}", .{value});
    try list.appendSlice(allocator, slice);
}
