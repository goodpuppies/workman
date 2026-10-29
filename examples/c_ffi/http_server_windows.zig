// zig build-exe examples/c_ffi/http_server_windows.zig -lc -lws2_32
// One blocking HTTP/1.1 request on http://127.0.0.1:8080/.
const c = @cImport({
    @cInclude("winsock2.h");
    @cInclude("stdlib.h");
    @cInclude("string.h");
});

pub fn main() u8 {
    var wsa: c.WSADATA = undefined;
    if (c.WSAStartup(0x0202, &wsa) != 0) return 1;
    defer _ = c.WSACleanup();

    const listener = c.socket(c.AF_INET, c.SOCK_STREAM, c.IPPROTO_TCP);
    if (listener == c.INVALID_SOCKET) return 1;
    defer _ = c.closesocket(listener);

    var address: c.struct_sockaddr_in = undefined;
    _ = c.memset(&address, 0, @sizeOf(@TypeOf(address)));
    address.sin_family = c.AF_INET;
    address.sin_port = c.htons(8080);
    address.sin_addr.S_un.S_addr = c.inet_addr("127.0.0.1");
    if (c.bind(listener, @ptrCast(&address), @sizeOf(@TypeOf(address))) != 0) return 1;
    if (c.listen(listener, 1) != 0) return 1;

    const client = c.accept(listener, null, null);
    if (client == c.INVALID_SOCKET) return 1;
    defer _ = c.closesocket(client);

    const buffer: [*]u8 = @ptrCast(c.malloc(4097) orelse return 1);
    defer c.free(buffer);
    var used: usize = 0;
    while (true) {
        if (used == 4096) return 1;
        const count = c.recv(client, buffer + used, @intCast(4096 - used), 0);
        if (count <= 0) return 1;
        used += @intCast(count);
        buffer[used] = 0;
        if (c.strstr(buffer, "\r\n\r\n") != null) break;
    }

    const response = "HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nhello\n";
    var sent: usize = 0;
    while (sent < response.len) {
        const count = c.send(client, response.ptr + sent, @intCast(response.len - sent), 0);
        if (count <= 0) return 1;
        sent += @intCast(count);
    }
    return if (c.shutdown(client, c.SD_SEND) == 0) 0 else 1;
}
