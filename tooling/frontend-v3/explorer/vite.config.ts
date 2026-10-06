export default {
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ["homepc.tail7771a7.ts.net"],
    proxy: { "/api": "http://127.0.0.1:5174" },
  },
};
