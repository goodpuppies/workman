# Supported editors and generated backends

## First-class editor support

The initial supported editor set is deliberately finite:

1. Visual Studio Code
2. Fresh
3. Helix
4. Zed
5. Neovim
6. Emacs

“Supported” means the generator emits everything syntax-related that the editor needs, the output
has automated fixtures, and installation or packaging is documented. It does not mean that every
editor receives identical structural precision.

Other editors may consume a generated format incidentally. They do not become first-class targets
until the repository has an owned package or installation path and tests for their behavior.

## Backend artifacts, not six grammars

The six editors require four syntax backend outputs:

| Generated backend | Consumers | Generated artifacts |
| --- | --- | --- |
| TextMate | VS Code | `tmLanguage.json`, scope mapping, derived language configuration where safe |
| Sublime Syntax | Fresh | `.sublime-syntax` and derived language-pack settings where safe |
| Tree-sitter | Helix, Zed, Neovim, Emacs | one grammar source, generated parser sources when distribution requires them, stable node/field schema |
| Tree-sitter query adapters | Helix, Zed, Neovim, Emacs | shared logical queries lowered to each consumer's captures and packaging; Emacs Lisp `treesit` rules for Emacs |

Helix, Zed, Neovim, and Emacs therefore do not get four independently maintained grammars. They use
one generated Tree-sitter grammar. What differs is the adapter around it.

## Per-editor decision

### Visual Studio Code

VS Code is a TextMate consumer. Generate the JSON grammar and the editor configuration that controls
comments, brackets, auto-closing, and surrounding pairs. The existing extension package remains a
thin handwritten shell around generated files.

Semantic tokens from the Workman language server are a separate, optional refinement. They must not
be required for immediate syntax highlighting.

### Fresh

Fresh is a Sublime Syntax consumer. Generate `.sublime-syntax` directly rather than routing it
through Tree-sitter. This preserves Fresh's chosen lightweight highlighting path and tests the
lexical-context lowering independently of TextMate.

Its language-pack manifest and LSP command remain small packaging configuration unless Fresh can
derive a field directly from syntax metadata.

### Helix

Helix consumes the shared Tree-sitter grammar and editor query files such as `highlights.scm`,
`indents.scm`, and `textobjects.scm`. `languages.toml` is packaging configuration pointing at a
released grammar revision; it is not another syntax definition.

### Zed

Zed consumes the same Tree-sitter grammar. Generate the Zed-supported query set from shared logical
queries, then keep the extension manifest and language registration as thin packaging.

### Neovim

Neovim consumes the same parser through its built-in Tree-sitter integration. Generate Neovim query
files and a minimal filetype/parser registration package. Do not make the design depend on the
`nvim-treesitter` plugin: that plugin can be an installation route, but Neovim itself owns the
runtime parser and query APIs.

### Emacs

Emacs uses the same Tree-sitter grammar when built with Tree-sitter support. Its adapter is a small
generated major mode or mode fragment containing `treesit-font-lock-rules` and related settings.
Those Lisp rules are generated from the shared logical highlight queries; they are not a separate
handwritten grammar.

A regex-only fallback mode is not part of the initial support promise. It can be added later from
the lexical-context IR if supporting Emacs builds without Tree-sitter becomes worthwhile.

## Shared Tree-sitter query source

The generator should own one logical query model for:

- highlighting;
- indentation;
- folding;
- text objects/selections;
- injections, if Workman later needs them.

That model refers to generated node names, fields, literal tokens, and backend-independent roles.
Each consumer adapter maps those facts to the captures and file layout it understands. A plain
`.scm` file may be byte-identical for several editors, but identical output is an optimization, not
an architectural assumption.

The required common denominator is highlighting. Indentation, folding, and text objects are emitted
only where the editor has a suitable facility and the shared syntax provides enough information.

## Support tiers

### Required at initial completion

- syntax highlighting;
- comments and string boundaries;
- correct multicharacter tokens;
- language/file detection;
- documented installation or package layout;
- generated-file drift checks;
- representative highlighting fixtures.

### Generated when naturally derivable

- comment toggling;
- bracket pairing and auto-closing;
- indentation queries;
- folding queries;
- text objects and structural selections.

### Explicitly outside the syntax backend contract

- LSP behavior;
- formatting;
- completion and diagnostics;
- editor commands and keymaps;
- themes and exact colors;
- marketplace publication and release automation.

Those features may be present in an editor package, but they are not evidence that another syntax
backend is needed.

## Initial implementation order

1. Generate TextMate and keep VS Code behavior stable.
2. Generate Sublime Syntax and keep Fresh behavior stable.
3. Generate the shared shallow Tree-sitter grammar and logical highlight queries.
4. Validate the Tree-sitter output in Helix, Zed, and Neovim adapters.
5. Generate the Emacs `treesit` adapter from the same logical query source.
6. Add indentation, folding, and text objects after highlighting is stable across all six editors.

This leaves three substantial recognition implementations—TextMate lowering, Sublime lowering, and
Tree-sitter lowering—plus small consumer adapters. It does not create six language definitions.
