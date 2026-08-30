((punctuation) @indent
  (#match? @indent "^[{\\[\\(]$"))

((punctuation) @outdent
  (#match? @outdent "^[}\\]\\)]$"))
