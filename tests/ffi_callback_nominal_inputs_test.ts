import { assertRejects } from "@std/assert";
import { checkSource } from "../src/compiler.ts";

Deno.test("Deno.serve contextual callback inputs retain nominal Request without annotations", async () => {
  await checkSource(`
    from js.global("Deno") import unsafe { serve };
    from js.global import unsafe { Response };
    let start = () => {
      serve(JSON{ hostname: "127.0.0.1", port: 5173 }, (request, _) => {
        Response.new(request.url)
      })
    };
  `);
});

Deno.test("contextual Request reflection still rejects nonexistent members", async () => {
  await assertRejects(() =>
    checkSource(`
    from js.global("Deno") import unsafe { serve };
    from js.global import unsafe { Response };
    let start = () => {
      serve(JSON{ hostname: "127.0.0.1", port: 5173 }, (request, _) => {
        Response.new(request.notARequestMember :> Result.debug)
      })
    };
  `)
  );
});
