"""Compare the maintained frontend-v3 parser/View fixtures through WM and native MLton."""
import json
from pathlib import Path
import subprocess
import tempfile

repository = Path(__file__).resolve().parents[1]
subsetml = repository / "subm/SubsetML"
compiler = subsetml / "bin/subsetml"
entry = repository / "tests/fixtures/frontend_v3_project_native.wm"
expected = "frontend-v3 native projector: 8 cases passed"

with tempfile.TemporaryDirectory(prefix="frontend-v3-projector-") as temporary:
    output = Path(temporary)
    basis = output / "basis"
    lowered = output / "sml"
    basis.mkdir()
    lowered.mkdir()
    modules = json.loads((subsetml / "docs/basis-dependencies.json").read_text())["modules"]
    files = ["src/subset_text_host.sml"]
    for name, module in modules.items():
        files.append(module["source"])
        if name == "SubsetResult":
            files.append("src/subset_host.sml")
    subprocess.run([compiler, "wm", basis, *files], cwd=subsetml, check=True)
    subprocess.run([
        compiler, "sml-entry", lowered, "--basis", basis,
        "--panic-runtime", basis / "subset_process.wm",
        "--native-adapter", basis / "subset_host.wm", subsetml / "lib/subset_host.sml", "SubsetHost",
        "--native-adapter", basis / "subset_text_host.wm",
        subsetml / "lib/subset_text_host.sml", "SubsetTextHost", entry,
    ], check=True)
    (lowered / "driver.sml").write_text("val _ = FrontendV3ProjectNative.main ()\n")
    (lowered / "run.mlb").write_text('"project.mlb"\n"driver.sml"\n')
    executable = output / "projector"
    subprocess.run(["mlton", "-output", executable, lowered / "run.mlb"], check=True)
    commands = [[executable], ["deno", "run", "-A", repository / "src/main.ts", "run", entry]]
    for command in commands:
        result = subprocess.run(command, cwd=repository, capture_output=True, text=True, check=True)
        if result.stdout.strip() != expected:
            raise AssertionError((command, result.stdout, result.stderr))
    print(expected + "; WM/native parity verified")
