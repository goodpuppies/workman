import raylib from "./raylib_ts_bindings_deno/raylib_bindings.ts";

const DEFAULT_RAYLIB_PATH = "./raylib.dll"

function main() {
  const raylibPath = Deno.args[0] ?? DEFAULT_RAYLIB_PATH;
  console.log(raylibPath)
  const title = "raylib ffi bindings demo";
  const message = "Hello from raylib via Deno FFI";
  const hint = "Close the window or press ESC to exit";

  raylib.loadRaylib(raylibPath);

  let windowInitialized = false;

  try {
    raylib.H.InitWindow(960, 540, title);
    windowInitialized = true;
    raylib.SetTargetFPS(60);

    const textColor = { r: 40, g: 44, b: 52, a: 255 } satisfies raylib.Color;
    const baseAccent = { r: 0, g: 121, b: 241, a: 255 } satisfies raylib.Color;

    while (!raylib.WindowShouldClose()) {
      const time = raylib.GetTime();
      const pulse = 0.55 + Math.sin(time * 2) * 0.25;
      const accent = raylib.H.Fade(baseAccent, pulse);
      const messageWidth = raylib.H.MeasureText(message, 32);
      const hintWidth = raylib.H.MeasureText(hint, 20);
      const centerX = Math.floor((raylib.GetScreenWidth() - messageWidth) / 2);
      const hintX = Math.floor((raylib.GetScreenWidth() - hintWidth) / 2);
      const circleX = Math.floor(480 + Math.sin(time) * 180);

      raylib.BeginDrawing();
      raylib.H.ClearBackground({ r: 245, g: 245, b: 245, a: 255 });
      raylib.H.DrawText(message, centerX, 170, 32, accent);
      raylib.H.DrawText(hint, hintX, 220, 20, textColor);
      raylib.H.DrawCircle(circleX, 320, 42, accent);
      raylib.DrawFPS(16, 16);
      raylib.EndDrawing();
    }
  } finally {
    if (windowInitialized) {
      raylib.CloseWindow();
    }
    raylib.unloadRaylib();
  }
}

if (import.meta.main) {
  main();
}
