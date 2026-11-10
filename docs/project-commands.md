# Project commands

Use `pak.wm` to describe commands for a local project:

```wm
from "pakman/project.wm" import { command, withEnv, Variable, Wm, Exec };

let commands = [
  command("build", [Wm(["compile", "src/main.wm", "dist/main.mjs"])]),
  withEnv([Variable("APP_MODE", "development")],
    command("dev", [Wm(["run", "serve.wm"])])),
  command("test", [Wm(["test", "tests"])]),
  command("bundle", [Exec("deno", ["bundle", "dist/main.mjs", "-o", "dist/app.js"])])
];
```

Run `wm run dev` from the project directory or any child directory. WM searches upward for the
nearest `pak.wm`. It runs every step from that file's directory. The file exports
`commands: List<Command>`; it needs no `main` function. An existing package recipe can export
commands alongside its package definition.

`Wm(arguments)` invokes the same WM installation that is running the command.
`Exec(program, arguments)` invokes an installed executable, using the inherited `PATH` when the
program is a bare name. Tools are not installed or version-managed. Arguments are passed directly,
without shell expansion or interpolation.

Steps run in order. A failed step stops the command and its exit code is returned.
`wm run test -- --filter "text binding"` appends the supplied arguments to the final step;
prerequisite steps receive only their declared arguments. Arguments can also follow the command name
without `--`.

Commands inherit the invoking environment. `withEnv` overrides the listed variables for every step
of that command. Working directory and environment changes apply to child processes, not to the
invoking shell. Termination signals are relayed to the active process; later steps do not start
after termination. External programs remain responsible for managing any children they spawn.

Names must start with an ASCII letter, followed by letters, digits, `_`, or `-`. Duplicate names and
empty step lists are errors. To run a file, include `.wm` or an explicit path: `wm run serve.wm` or
`wm run ./dev`. File operands bypass project command discovery, even when the file is missing.
Unknown commands report the available names in the nearest project.

Project descriptions are compiled and evaluated separately from command execution. Evaluation runs
without Deno filesystem, network, environment, or subprocess permissions. Keep the description pure;
effects belong in the declared commands. The evaluated description has a ten-second runtime limit.
Compilation uses the normal WM compiler and reflection pipeline.

Ecosystem configuration stays with its tools. For a Deno project, `deno.json` continues to own the
import map and `deno.lock` owns npm resolutions. A project command can invoke those tools without
repeating their configuration in `pak.wm`. The React example in `examples/fullstack/react`
demonstrates a compile-and-bundle build, a development server, and tests.

Wrap a command in `watch(paths, command)` to repeat it on input changes:

```wm
from "pakman/project.wm" import { command, watch, Wm, Exec };

let commands = [
  watch(["src", "serve.wm", "index.html", "deno.json"],
    command("dev", [
      Wm(["compile", "src/main.wm", "dist/main.mjs"]),
      Exec("deno", ["bundle", "--platform=browser", "dist/main.mjs", "-o", "dist/app.js"]),
      Wm(["run", "serve.wm"])
    ]))
];
```

`wm run dev` runs immediately, then watches the listed paths relative to `pak.wm`. Directories are
watched recursively; file paths also detect atomic replacements and creation of initially missing
inputs. Save events are debounced. On a change, WM stops and waits for the active process before
restarting from the first step. Changes during a build also restart it. Failed commands stay
watching and retry on the next edit. Ctrl-C stops the watcher and its active process.

Keep generated outputs outside the watched paths to avoid rebuild loops. The watcher uses explicit
paths, so include imported sources outside those paths when needed. Changes to `pak.wm` require
restarting the command. This is separate from `wm watch file.wm`, which automatically follows that
file's WM imports. Browser reload is supplied by the application: the React example polls a server
revision and reloads the page after a successful restart, resetting browser state.

This interface covers local commands. Managed development environments, build artifact graphs,
incremental builds, and concurrent process supervision are separate future capabilities.

For setup that downloads and extracts files into the project, use the ordinary
[file helpers](file-helpers.md) from a runtime function in `pak.wm`.
