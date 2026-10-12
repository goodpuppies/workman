# pakman vs Nix

Comparisons grounded in the sources under `research/` (see [../research.md](../research.md)).
They measure outcomes for the same goal, not whether pakman does things the Nix way.

| document | status | question |
|---|---|---|
| [packages.md](packages.md) | done | the same software in nixpkgs, cachy-packages and pakman: cost to write, update, install |
| [store-model.md](store-model.md) | done | what the Nix store buys, what pakman's FHS approach gives up, and how to recover it |
| language.md | planned | laziness, overrides and overlays, `callPackage`, types (string context: see ../wm-vs-nix.md) |
| updates.md | planned | `updateScript`, nix-update and the update bot vs finders, policy and the lock |
| cross.md | planned | `lib.systems`, `pkgsCross`, `buildPackages` splicing vs pakman's `Target` (PS2) |

Language-level findings from building pakman in wm are logged separately in
[../wm-vs-nix.md](../wm-vs-nix.md).
