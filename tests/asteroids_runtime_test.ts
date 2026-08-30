import { assertEquals } from "@std/assert";
import { compileLibraryVirtual } from "../src/compiler.ts";

const asteroids = new URL("../examples/asteroids/", import.meta.url);

Deno.test("asteroids collision walks do not consume the JavaScript call stack", async () => {
  const virtualFs = new Map<string, string>();
  for (const name of ["game.wm", "rng.wm", "trig.wm", "vec.wm"]) {
    virtualFs.set(`/test/${name}`, await Deno.readTextFile(new URL(name, asteroids)));
  }
  virtualFs.set(
    "/test/stress.wm",
    `
      from "./game.wm" import { Asteroid, Bullet, Large, resolveHits, takeHit };
      from "./rng.wm" import { Seed };
      from "./vec.wm" import { Vec2, zero };

      let rec bullets = (count, acc) => {
        if (count == 0) { acc } else {
          bullets(count - 1, [Bullet(zero, zero, 1), ..acc])
        }
      };
      let rec rocks = (count, acc) => {
        if (count == 0) { acc } else {
          rocks(count - 1, [Asteroid(zero, zero, Large, 0, 0), ..acc])
        }
      };

      let noHit = takeHit(bullets(5000, []), Vec2(10000, 10000), 1);
      let impact = resolveHits(rocks(5000, []), [], Seed(1));
      let middleRemoved = takeHit([
        Bullet(Vec2(0, 0), zero, 1),
        Bullet(Vec2(10, 0), zero, 1),
        Bullet(Vec2(20, 0), zero, 1)
      ], Vec2(10, 0), 0);
      let verified = match(noHit, impact.rocks, middleRemoved) {
        (None, [rock, ..rocksAfter], Some([first, last])) => {
          if (first.pos.x == 0 && last.pos.x == 20) {
            true
          } else {
            Panic("takeHit changed the order of surviving bullets")
          }
        },
        _ => { Panic("asteroids collision stress result was incorrect") },
      };
    `,
  );

  const js = await compileLibraryVirtual("/test/stress.wm", virtualFs);
  const directory = await Deno.makeTempDir();
  const emitted = `${directory}/stress.mjs`;
  try {
    await Deno.writeTextFile(emitted, js);
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "--v8-flags=--stack-size=128", emitted],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await command.output();
    assertEquals(
      result.code,
      0,
      new TextDecoder().decode(result.stderr),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
