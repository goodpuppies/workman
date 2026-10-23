//! `won-zig normalize`: read one document from stdin, write canonical WON or an
//! error, matching the WM probe's normalize mode for the interop tests.
const std = @import("std");
const won = @import("won");

pub fn main(init: std.process.Init) !void {
    const arena = init.arena.allocator();
    const args = try init.minimal.args.toSlice(arena);
    const mode = if (args.len > 1) args[1] else "normalize";
    if (!std.mem.eql(u8, mode, "normalize")) {
        try std.Io.File.stderr().writeStreamingAll(init.io, "usage: won-zig normalize < document\n");
        std.process.exit(2);
    }
    var buffer: [4096]u8 = undefined;
    var stdin = std.Io.File.stdin().reader(init.io, &buffer);
    const source = try stdin.interface.allocRemaining(arena, .unlimited);
    var diagnostic: won.Diagnostic = .{};
    const output = won.normalize(arena, source, &diagnostic) catch |e| {
        const message = switch (e) {
            error.Syntax => try std.fmt.allocPrint(arena, "byte {d}: {s}\n", .{ diagnostic.offset, diagnostic.message }),
            else => try std.fmt.allocPrint(arena, "{s}\n", .{@errorName(e)}),
        };
        try std.Io.File.stderr().writeStreamingAll(init.io, message);
        std.process.exit(1);
    };
    try std.Io.File.stdout().writeStreamingAll(init.io, output);
    try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
}
