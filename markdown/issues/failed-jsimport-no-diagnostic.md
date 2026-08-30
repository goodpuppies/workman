if we have something like "from js.module("missing path") import * as Raylib;"
we get no error and instead Raylib is just a fully dynamic js object, this causes later errors which are misleading