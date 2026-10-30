"""Check the maintained WM JSON modules with SubsetML and execute them with MLton."""
import json
from pathlib import Path
import subprocess

repository = Path(__file__).resolve().parents[1]
subsetml = repository / "subm/SubsetML"
output = repository / "_scratch/json-native"
basis = output / "basis"
lowered = output / "sml"
basis.mkdir(parents=True, exist_ok=True)
lowered.mkdir(parents=True, exist_ok=True)
modules = json.loads((subsetml / "docs/basis-dependencies.json").read_text())["modules"]
files = ["src/subset_text_host.sml"]
for name, module in modules.items():
    files.append(module["source"])
    if name == "SubsetResult":
        files.append("src/subset_host.sml")
compiler = subsetml / "bin/subsetml"
subprocess.run([compiler, "wm", basis, *files], cwd=subsetml, check=True)
subprocess.run([
    compiler, "sml-entry", lowered, "--basis", basis,
    "--native-adapter", basis / "subset_text_host.wm", subsetml / "lib/subset_text_host.sml", "SubsetTextHost",
    repository / "tests/fixtures/json_native.wm",
], check=True)
# All generated JSON sources must pass the restricted library-availability profile.
# Supply checker declarations here; full native adapter code is not authored source.
json_sources = [lowered / f"{name}.sml" for name in ["json_value", "json_parser", "json", "json_native"]]
if not all(p.exists() for p in json_sources):
    raise RuntimeError(f"unexpected JSON source graph: {json_sources}")
subprocess.run([compiler, "check-portable", *files, *json_sources], cwd=subsetml, check=True)
(lowered / "json-driver.sml").write_text(
    'val _ = if JsonNative.checks then print "portable native JSON: ok\\n" else raise Fail "JSON contracts"\n'
)
(lowered / "json-test.mlb").write_text('"project.mlb"\n"json-driver.sml"\n')
subprocess.run(["mlton", "-output", output / "json-native", lowered / "json-test.mlb"], check=True)
subprocess.run([output / "json-native"], check=True)
