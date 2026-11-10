# File helpers (prototype)

`pakman/files.wm` exposes ordinary effectful functions for project setup:

```wm
from "pakman/files.wm" import { fetch, unpack };

let main = () => {
  fetch(.{ url = "https://example.org/library.tar.gz", sha256 = "<SHA-256>" }, "_scratch/library.tar.gz")
    :> Task.andThen((archive) => { unpack(archive, "vendor/library", 1) })
    :> Task.recover((error) => { Panic(error) })
};
```

Use an actual URL and 64-character lowercase hexadecimal SHA-256. `fetch` accepts
HTTPS and local `file:` URLs. It returns `Task<String, String>` with the destination
path. If that file already matches the hash, it is reused without downloading.
Otherwise a download is verified before replacing the destination; a failed
download or hash check leaves the previous file intact.

`unpack(archive, destination, strip)` returns `Task<Void, String>`. It extracts
using `bsdtar`, creating the destination and removing `strip` leading path
components. Existing archive members are overwritten. Unrelated files remain;
extraction is not a directory synchronization or an atomic replacement.

Call these functions inside `main` or another runtime function. Tasks are eager;
putting a call at module top level would run it while the module is imported,
including during sandboxed project-command description evaluation.

The same `pak.wm` can export normal commands:

```wm
from "pakman/project.wm" import { command, Wm };
let setup = Wm(["run", "pak.wm"]);
let commands = [
  command("setup", [setup]),
  command("dev", [setup, Wm(["run", "src/main.wm"])])
];
```

After `wm run setup`, the application imports ordinary paths under `vendor/`.
No bindings, dependency-aware imports, package recipe, profile installation,
or lock file is involved. The URL and hash in the setup code pin the download.
Generated archives and extracted files can be gitignored.

The implementation shares pakman's download and extraction functions, exposed
from the self-contained `tooling/pakman/api/js/files.ts` module. It adds no new
project-command protocol. It currently requires the host's `bsdtar` and does
not pin the compiler, tools, or system libraries.
