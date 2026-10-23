//! IPC peer for the Rust driver: one canonical WON envelope per line on stdin,
//! one reply per line on stdout. Failures become `Error` replies.
const std = @import("std");
const won = @import("won");
const typed = won.typed;

const Hand = enum { left, right };
const Pose = struct { hand: Hand, position: [3]f64, rotation: [4]f64 };
const Wide = struct { big: u128, small: i64, ch: []const u8 };
const Rename = struct { from: []const u8, to: ?[]const u8 = null };

const Request = union(enum) {
    Ping,
    Echo: won.Value,
    Health,
    SetPose: Pose,
    Frame: struct { width: u32, height: u32, pixels: typed.Blob },
    Rename: Rename,
    Floats: []const f64,
    Wide: Wide,
};

const Response = union(enum) {
    Pong,
    Echoed: won.Value,
    Health: struct { run_frame_count: u64, ipc_sessions: u32, uptime: f64 },
    Ack,
    FrameStats: struct { bytes: u64, checksum: u32 },
    Renamed: Rename,
    Floats: []const f64,
    Wide: Wide,
    Error: struct { message: []const u8, event: []const u8 },
};

fn Envelope(comptime Body: type) type {
    return struct { id: u64, body: Body };
}

fn fail(message: []const u8, event: []const u8) Response {
    return .{ .Error = .{ .message = message, .event = event } };
}

fn handle(request: Request) Response {
    return switch (request) {
        .Ping => .Pong,
        .Echo => |v| .{ .Echoed = v },
        .Health => .{ .Health = .{ .run_frame_count = std.math.maxInt(u64), .ipc_sessions = 2, .uptime = 0.1 } },
        .SetPose => |pose| blk: {
            var length: f64 = 0;
            for (pose.rotation) |q| length += q * q;
            break :blk if (@sqrt(length) < 0.5) fail("InvalidRotation", "set-pose") else .Ack;
        },
        .Frame => |frame| blk: {
            var checksum: u32 = 0;
            for (frame.pixels.bytes) |b| checksum +%= b;
            break :blk .{ .FrameStats = .{ .bytes = frame.pixels.bytes.len, .checksum = checksum } };
        },
        .Rename => |r| .{ .Renamed = r },
        .Floats => |xs| .{ .Floats = xs },
        .Wide => |w| .{ .Wide = w },
    };
}

/// Decode untyped first so a bad body can still be answered with its id.
fn reply(arena: std.mem.Allocator, line: []const u8) !Envelope(Response) {
    var diagnostic: won.Diagnostic = .{};
    const document = won.parse(arena, line, &diagnostic) catch |e| {
        const message = switch (e) {
            error.Syntax => try std.fmt.allocPrint(arena, "byte {d}: {s}", .{ diagnostic.offset, diagnostic.message }),
            else => @errorName(e),
        };
        return .{ .id = 0, .body = fail(message, "parse") };
    };
    const id = typed.fromValue(u64, arena, document.get("id") orelse .null) catch 0;
    const request = typed.fromValue(Request, arena, document.get("body") orelse .null) catch |e|
        return .{ .id = id, .body = fail(@errorName(e), "decode") };
    return .{ .id = id, .body = handle(request) };
}

pub fn main(init: std.process.Init) !void {
    var in_buffer: [64 * 1024]u8 = undefined;
    var stdin = std.Io.File.stdin().reader(init.io, &in_buffer);
    var out_buffer: [64 * 1024]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(init.io, &out_buffer);
    var arena: std.heap.ArenaAllocator = .init(init.gpa);
    defer arena.deinit();
    while (true) {
        _ = arena.reset(.retain_capacity);
        const a = arena.allocator();
        var line: std.Io.Writer.Allocating = .init(a);
        _ = stdin.interface.streamDelimiter(&line.writer, '\n') catch |e| switch (e) {
            error.EndOfStream => return,
            else => return e,
        };
        stdin.interface.toss(1);
        const response = try reply(a, line.written());
        try stdout.interface.writeAll(try typed.stringify(a, response));
        try stdout.interface.writeByte('\n');
        try stdout.interface.flush();
    }
}
