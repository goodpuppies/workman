//! Typed conversion in the style of `std.json.parseFromValue`: the Zig type is
//! the schema, read through `@typeInfo`. The mapping choices here are the
//! experiment; see ../../markdown/won-zig.md for the edges they expose.
const std = @import("std");
const Allocator = std.mem.Allocator;
const won = @import("won.zig");
const Value = won.Value;

/// Bytes rather than UTF-8 text. Zig spells both `[]const u8`, so plain
/// slices map to text and blobs need this wrapper.
pub const Blob = struct { bytes: []const u8 };

pub const Error = error{
    UnexpectedKind,
    MissingField,
    UnknownField,
    InvalidNumber,
    InvalidLength,
    UnknownTag,
    UnexpectedAttributes,
    InvalidValue,
    OutOfMemory,
};

/// Parse a document straight into `T`. Allocations go to `arena`.
pub fn parseFromSlice(comptime T: type, arena: Allocator, source: []const u8, diagnostic: *won.Diagnostic) (won.ParseError || Error)!T {
    return fromValue(T, arena, try won.parse(arena, source, diagnostic));
}

/// Render `value` as canonical WON.
pub fn stringify(arena: Allocator, value: anytype) (Error || won.WriteError)![]u8 {
    var out: std.Io.Writer.Allocating = .init(arena);
    try won.write(&out.writer, try toValue(arena, value));
    return out.toOwnedSlice();
}

pub fn fromValue(comptime T: type, arena: Allocator, v: Value) Error!T {
    if (T == Value) return v;
    if (T == Blob) return if (v == .blob) .{ .bytes = v.blob } else error.UnexpectedKind;
    switch (@typeInfo(T)) {
        .void => return if (v == .null) {} else error.UnexpectedKind,
        .bool => return if (v == .boolean) v.boolean else error.UnexpectedKind,
        // Integers accept integer spellings only: `1e3` and `1.0` are rejected.
        .int => {
            if (v != .number) return error.UnexpectedKind;
            return std.fmt.parseInt(T, v.number, 10) catch error.InvalidNumber;
        },
        .float => {
            if (v != .number) return error.UnexpectedKind;
            const f = std.fmt.parseFloat(T, v.number) catch return error.InvalidNumber;
            return if (std.math.isFinite(f)) f else error.InvalidNumber;
        },
        .optional => |o| return if (v == .null) null else try fromValue(o.child, arena, v),
        .@"enum" => {
            const t = try bareTag(v);
            return std.meta.stringToEnum(T, t.name) orelse error.UnknownTag;
        },
        .@"union" => |u| {
            if (u.tag_type == null) @compileError("untagged union " ++ @typeName(T));
            if (v != .tag) return error.UnexpectedKind;
            if (v.tag.attributes.len > 0) return error.UnexpectedAttributes;
            inline for (u.fields) |field| {
                if (std.mem.eql(u8, field.name, v.tag.name)) {
                    if (field.type == void) {
                        if (v.tag.payload.* != .null) return error.UnexpectedKind;
                        return @unionInit(T, field.name, {});
                    }
                    return @unionInit(T, field.name, try fromValue(field.type, arena, v.tag.payload.*));
                }
            }
            return error.UnknownTag;
        },
        .@"struct" => |s| {
            if (s.is_tuple) {
                if (v != .list) return error.UnexpectedKind;
                if (v.list.len != s.fields.len) return error.InvalidLength;
                var result: T = undefined;
                inline for (s.fields, 0..) |field, i| @field(result, field.name) = try fromValue(field.type, arena, v.list[i]);
                return result;
            }
            if (v != .record) return error.UnexpectedKind;
            var result: T = undefined;
            inline for (s.fields) |field| {
                // A missing field takes its default; a missing optional is null.
                @field(result, field.name) = if (v.get(field.name)) |item|
                    try fromValue(field.type, arena, item)
                else if (field.defaultValue()) |default|
                    default
                else if (@typeInfo(field.type) == .optional)
                    null
                else
                    return error.MissingField;
            }
            for (v.record) |entry| {
                const known = inline for (s.fields) |field| {
                    if (std.mem.eql(u8, field.name, entry.key)) break true;
                } else false;
                if (!known) return error.UnknownField;
            }
            return result;
        },
        .array => |a| {
            if (v != .list) return error.UnexpectedKind;
            if (v.list.len != a.len) return error.InvalidLength;
            var result: T = undefined;
            for (&result, v.list) |*slot, item| slot.* = try fromValue(a.child, arena, item);
            return result;
        },
        .pointer => |p| switch (p.size) {
            .slice => {
                if (p.child == u8) return if (v == .text) v.text else error.UnexpectedKind;
                if (v != .list) return error.UnexpectedKind;
                const result = try arena.alloc(p.child, v.list.len);
                for (result, v.list) |*slot, item| slot.* = try fromValue(p.child, arena, item);
                return result;
            },
            .one => {
                const result = try arena.create(p.child);
                result.* = try fromValue(p.child, arena, v);
                return result;
            },
            else => @compileError("unsupported pointer " ++ @typeName(T)),
        },
        else => @compileError("unsupported type " ++ @typeName(T)),
    }
}

fn bareTag(v: Value) Error!won.Tag {
    if (v != .tag) return error.UnexpectedKind;
    if (v.tag.attributes.len > 0) return error.UnexpectedAttributes;
    if (v.tag.payload.* != .null) return error.UnexpectedKind;
    return v.tag;
}

pub fn toValue(arena: Allocator, x: anytype) Error!Value {
    const T = @TypeOf(x);
    if (T == Value) return x;
    if (T == Blob) return .{ .blob = x.bytes };
    switch (@typeInfo(T)) {
        .void => return .null,
        .bool => return .{ .boolean = x },
        .int, .comptime_int => return .{ .number = try std.fmt.allocPrint(arena, "{d}", .{x}) },
        .float, .comptime_float => return .{ .number = try floatSpelling(arena, x) },
        .optional => return if (x) |inner| toValue(arena, inner) else .null,
        .@"enum" => return .{ .tag = .{ .name = @tagName(x) } },
        .@"union" => |u| {
            if (u.tag_type == null) @compileError("untagged union " ++ @typeName(T));
            switch (x) {
                inline else => |payload, tag| {
                    const body = try arena.create(Value);
                    body.* = if (@TypeOf(payload) == void) .null else try toValue(arena, payload);
                    return .{ .tag = .{ .name = @tagName(tag), .payload = body } };
                },
            }
        },
        .@"struct" => |s| {
            if (s.is_tuple) {
                const items = try arena.alloc(Value, s.fields.len);
                inline for (s.fields, 0..) |field, i| items[i] = try toValue(arena, @field(x, field.name));
                return .{ .list = items };
            }
            var entries: std.ArrayList(won.Field) = .empty;
            inline for (s.fields) |field| {
                const item = @field(x, field.name);
                // Null optionals are omitted, so absence is the one spelling of "none".
                const omit = @typeInfo(field.type) == .optional and item == null;
                if (!omit) try entries.append(arena, .{ .key = field.name, .value = try toValue(arena, item) });
            }
            return .{ .record = try entries.toOwnedSlice(arena) };
        },
        .array => return toValue(arena, @as([]const @typeInfo(T).array.child, &x)),
        .pointer => |p| switch (p.size) {
            .slice => {
                if (p.child == u8) {
                    if (!std.unicode.utf8ValidateSlice(x)) return error.InvalidValue;
                    return .{ .text = x };
                }
                const items = try arena.alloc(Value, x.len);
                for (items, x) |*slot, item| slot.* = try toValue(arena, item);
                return .{ .list = items };
            },
            .one => switch (@typeInfo(p.child)) {
                // String literals are pointers to arrays of u8.
                .array => |a| return toValue(arena, @as([]const a.child, x)),
                else => return toValue(arena, x.*),
            },
            else => @compileError("unsupported pointer " ++ @typeName(T)),
        },
        else => @compileError("unsupported type " ++ @typeName(T)),
    }
}

/// Shortest round-trip digits, in decimal for ordinary magnitudes as JS does.
fn floatSpelling(arena: Allocator, x: anytype) Error![]const u8 {
    const f: f64 = x;
    if (!std.math.isFinite(f)) return error.InvalidValue;
    const magnitude = @abs(f);
    const spelling = if (magnitude == 0 or (magnitude >= 1e-6 and magnitude < 1e21))
        try std.fmt.allocPrint(arena, "{d}", .{x})
    else
        try std.fmt.allocPrint(arena, "{e}", .{x});
    if (!won.isNumber(spelling)) return error.InvalidValue;
    return spelling;
}

// Shapes from the Stageforge envelopes and the PetPlay driver.
const Hand = enum { left, right };
const Address = struct { fm: []const u8, to: []const u8 };
const Pose = struct { hand: Hand, position: [3]f64, rotation: [4]f64 };
const Health = struct { runFrameCount: u64, ipcSessions: u32 };
const Command = union(enum) {
    Ready,
    Pose: Pose,
    Count: u64,
    ActorError: struct { message: []const u8, event: []const u8 },
};
const Envelope = struct {
    address: Address,
    type: []const u8,
    payload: ?Value = null,
};

test "typed round trip through canonical text" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const commands = [_]Command{
        .Ready,
        .{ .Pose = .{ .hand = .left, .position = .{ 0.1, -0.0, 1.5 }, .rotation = .{ 0, 0, 0, 1 } } },
        .{ .Count = std.math.maxInt(u64) },
        .{ .ActorError = .{ .message = "ControllersDisabled", .event = "controller-command" } },
    };
    const text = try stringify(a, commands);
    try std.testing.expectEqualStrings(
        "[Ready Pose{hand = left position = [0.1 -0 1.5] rotation = [0 0 0 1]} Count(18446744073709551615) " ++
            "ActorError{message = \"ControllersDisabled\" event = \"controller-command\"}]",
        text,
    );
    var diagnostic: won.Diagnostic = .{};
    const back = try parseFromSlice([]const Command, a, text, &diagnostic);
    try std.testing.expectEqual(@as(usize, 4), back.len);
    try std.testing.expectEqual(std.math.maxInt(u64), back[2].Count);
    try std.testing.expectEqualStrings("controller-command", back[3].ActorError.event);
}

test "envelopes keep unfamiliar payloads untyped" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var diagnostic: won.Diagnostic = .{};
    const e = try parseFromSlice(Envelope, a,
        \\{address = {fm = "main" to = "driver"} type = "HEALTH:42" payload = {runFrameCount = 9007199254740993 ipcSessions = 2}}
    , &diagnostic);
    const health = try fromValue(Health, a, e.payload.?);
    try std.testing.expectEqual(@as(u64, 9007199254740993), health.runFrameCount);
    const bare = try parseFromSlice(Envelope, a, "{address = {fm = \"a\" to = \"b\"} type = \"PING\"}", &diagnostic);
    try std.testing.expect(bare.payload == null);
    // `?Value` cannot tell an omitted payload from an explicit null.
    const explicit = try parseFromSlice(Envelope, a, "{address = {fm = \"a\" to = \"b\"} type = \"PING\" payload = null}", &diagnostic);
    try std.testing.expect(explicit.payload == null);
}

test "conversion errors" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var d: won.Diagnostic = .{};
    try std.testing.expectError(error.InvalidNumber, parseFromSlice(u64, a, "18446744073709551616", &d));
    try std.testing.expectError(error.InvalidNumber, parseFromSlice(u64, a, "1e3", &d));
    try std.testing.expectError(error.InvalidNumber, parseFromSlice(f64, a, "1e400", &d));
    try std.testing.expectError(error.UnknownField, parseFromSlice(Address, a, "{fm = \"a\" to = \"b\" extra = 1}", &d));
    try std.testing.expectError(error.MissingField, parseFromSlice(Address, a, "{fm = \"a\"}", &d));
    try std.testing.expectError(error.UnexpectedAttributes, parseFromSlice(Hand, a, "left<x = 1>", &d));
    try std.testing.expectError(error.UnknownTag, parseFromSlice(Hand, a, "middle", &d));
    try std.testing.expectError(error.InvalidLength, parseFromSlice([3]f64, a, "[1 2]", &d));
    try std.testing.expectError(error.UnexpectedKind, parseFromSlice([]const u8, a, "x\"00\"", &d));
    const blob = try parseFromSlice(Blob, a, "x\"00ff\"", &d);
    try std.testing.expectEqualSlices(u8, &.{ 0, 255 }, blob.bytes);
    try std.testing.expectError(error.InvalidValue, stringify(a, @as([]const u8, "\xff")));
    try std.testing.expectError(error.InvalidValue, stringify(a, std.math.nan(f64)));
    try std.testing.expectEqualStrings("[null 1]", try stringify(a, .{ {}, @as(?u8, 1) }));
    try std.testing.expectEqualStrings("[1 null]", try stringify(a, [_]?u8{ 1, null }));
}
