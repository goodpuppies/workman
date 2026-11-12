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

Deno.test("fetch callbacks retain foreign Response identity when a member overlaps a record label", async () => {
  await checkSource(`
    from js.global import { fetch };
    record LabelCollision = { text: String, bytes: String };
    let loadEncoded = (url: String) => {
      fetch(url) :> Task.andThen((response) => { response :> .bytes() })
    };
  `);
});

Deno.test("fetch callbacks retain pending FFI input identity before URL helper reflection", async () => {
  await checkSource(`
    from js.global import { fetch };
    record LabelCollision = { text: String };
    let pngUrl = (url) => { url :> .slice(0) :> Result.getOr(url) };
    let loadEncoded = (url) => {
      fetch(pngUrl(url)) :> Task.andThen((response) => { response :> .text() })
    };
  `);
});

Deno.test("unannotated response helpers do not select non-callable record labels as methods", async () => {
  await checkSource(`
    from js.global import { fetch };
    record LabelCollision = { text: String };
    let readBody = (response) => { response :> .text() };
    let loadEncoded = (url: String) => { fetch(url) :> Task.andThen(readBody) };
  `);
});
