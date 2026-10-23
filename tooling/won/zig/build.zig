const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const won = b.addModule("won", .{
        .root_source_file = b.path("src/won.zig"),
        .target = target,
        .optimize = optimize,
    });
    const exe = b.addExecutable(.{
        .name = "won-zig",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "won", .module = won }},
        }),
    });
    b.installArtifact(exe);
    b.installArtifact(b.addExecutable(.{
        .name = "won-zig-peer",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/peer.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "won", .module = won }},
        }),
    }));

    const tests = b.addTest(.{ .root_module = won });
    const test_step = b.step("test", "Run the reader, writer, and typed-conversion tests");
    test_step.dependOn(&b.addRunArtifact(tests).step);
}
