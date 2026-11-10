# Support color themes in the REPL

Status: open, wanted eventually. Recorded 2026-11-05.

## Current state

The REPL has one built-in palette, in `src/repl_highlight.ts`:

- `WORKMAN_STYLES`, built around the orange of the logo and loading bar, on terminals that report
  truecolor through `COLORTERM`.
- `BASIC_STYLES`, the 16-color palette, on every other terminal.

The only setting is `repl.highlight`, which turns highlighting on or off.

## Why themes

`WORKMAN_STYLES` was chosen on a dark background. Function names use the terminal's default
foreground color, so they follow its light or dark theme, but strings and types still use fixed pale
colors that can be hard to read on a light background. Today the only way around those colors is
`repl.highlight: false`, or unsetting `COLORTERM`, which also drops the loading bar's colors.

## What it could look like

A `repl.theme` setting in the user config, next to `prompt`:

- A built-in name, such as `workman`, `basic` or a light variant.
- Possibly a table of custom colors per highlight kind, validated the way `repl.prompt` is, since
  control characters in a color would corrupt the editor's output.

## Questions to settle

- Should it also try to detect a light background? Not every terminal answers that query, and the
  REPL would have to wait for the reply before drawing.
- Should the prompt and loading bar follow the theme too? The prompt is dim and the bar has its own
  orange gradient, and neither is part of the palette today.
- Which highlight kinds should a theme control? `constant` and `number` currently share a color, as
  do `keyword` and `command`. Identifiers, operators and punctuation aren't highlighted at all, so a
  theme can't color them.
- Which themes should be built in? Other palettes tried while choosing the default were Tokyo Night,
  Catppuccin Mocha, Gruvbox, Nord, Rosé Pine, Kanagawa and One Dark.
