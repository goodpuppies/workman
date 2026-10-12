# Research material

Reference sources for the Nix comparison live in `research/` (not committed; about 45 MB). The
disk is nearly full, so the clones are shallow and nixpkgs is a sparse checkout.

| path | what | why |
|---|---|---|
| `research/nix/` | NixOS/nix: `doc/manual`, `src/libexpr/primops`, `src/nix` | the language, store and CLI as specified |
| `research/nixpkgs/` | NixOS/nixpkgs, sparse | how packages are actually written, and what each one costs to maintain |
| `research/nix.dev/` | NixOS/nix.dev | the official tutorials: what newcomers are taught |
| `research/nix-update/` | Mic92/nix-update | how Nix does automatic version bumps |
| `research/papers/dolstra-phd-thesis.pdf` | *The Purely Functional Software Deployment Model* (2006) | the design rationale |

nixpkgs paths checked out:

- `doc/`, `lib/` (including `lib/systems` for cross-compilation), `pkgs/stdenv/`,
  `pkgs/build-support/`, `pkgs/top-level/`, `maintainers/scripts/` (update.nix)
- packages pakman also has, for like-for-like comparison:
  `pkgs/by-name/t3/t3code`, `pkgs/by-name/bi/bitwig-studio6`, `pkgs/by-name/ll/llama-cpp-rocm`,
  `pkgs/applications/editors/vscode`, `pkgs/development/python-modules/{vllm,torch}`,
  `pkgs/by-name/zs/zsh`, `pkgs/by-name/pf/pfetch`, `pkgs/os-specific/linux/musl`

## Fetching it again

```sh
mkdir -p research && cd research
git clone --depth 1 --filter=blob:none --sparse https://github.com/NixOS/nix.git
git -C nix sparse-checkout set doc/manual src/libexpr/primops src/nix
git clone --depth 1 --filter=blob:none --sparse https://github.com/NixOS/nixpkgs.git
git -C nixpkgs sparse-checkout set --no-cone /doc/ /lib/ /pkgs/stdenv/ /pkgs/build-support/ \
  /pkgs/top-level/ /maintainers/scripts/ /pkgs/by-name/t3/ /pkgs/by-name/bi/ /pkgs/by-name/ll/ \
  /pkgs/by-name/zs/ /pkgs/by-name/pf/ /pkgs/by-name/vs/ /pkgs/by-name/ap/ \
  /pkgs/applications/editors/vscode/ /pkgs/development/python-modules/vllm/ \
  /pkgs/development/python-modules/torch/ /pkgs/os-specific/linux/musl/
git clone --depth 1 https://github.com/NixOS/nix.dev.git
git clone --depth 1 https://github.com/Mic92/nix-update.git
mkdir -p papers && curl -sSfLo papers/dolstra-phd-thesis.pdf https://edolstra.github.io/pubs/phd-thesis.pdf
```

To add another nixpkgs package: `git -C research/nixpkgs sparse-checkout add /pkgs/by-name/xx/name/`.
