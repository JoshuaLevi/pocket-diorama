#!/usr/bin/env python3
"""Parse the restricted Lua-table dialect emitted by gen1recomp's
tools/build_rom_data.py and re-emit it as canonical JSON.

The generated files are machine-written and use only: `return <table>`,
`key = value`, bare array items, strings, numbers, booleans, nil, and nested
tables. That is small enough to parse exactly rather than approximately.

A Lua table is both a list and a map. We keep that distinction: a table whose
keys are all positive consecutive integers starting at 1 becomes a JSON array;
anything else becomes a JSON object.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

TOKEN = re.compile(
    r"""
      (?P<ws>\s+|--[^\n]*)
    | (?P<str>"(?:[^"\\]|\\.)*")
    | (?P<num>-?(?:0[xX][0-9a-fA-F]+|\d+\.\d+(?:[eE][-+]?\d+)?|\.\d+|\d+(?:[eE][-+]?\d+)?))
    | (?P<name>[A-Za-z_]\w*)
    | (?P<punct>[{}\[\]=,;])
    """,
    re.VERBOSE,
)

ESCAPES = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "'": "'", "a": "\a", "b": "\b", "f": "\f", "v": "\v"}


def tokenize(src: str):
    pos, end, out = 0, len(src), []
    while pos < end:
        m = TOKEN.match(src, pos)
        if not m:
            raise SyntaxError(f"cannot tokenize at offset {pos}: {src[pos:pos + 40]!r}")
        pos = m.end()
        if m.lastgroup == "ws":
            continue
        out.append((m.lastgroup, m.group()))
    return out


def unquote(raw: str) -> str:
    body, out, i = raw[1:-1], [], 0
    while i < len(body):
        c = body[i]
        if c == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in ESCAPES:
                out.append(ESCAPES[nxt]); i += 2; continue
            if nxt.isdigit():
                j = i + 1
                while j < len(body) and j < i + 4 and body[j].isdigit():
                    j += 1
                out.append(chr(int(body[i + 1:j]))); i = j; continue
            out.append(nxt); i += 2; continue
        out.append(c); i += 1
    return "".join(out)


def to_number(raw: str):
    if raw.lower().startswith(("0x", "-0x")):
        return int(raw, 16)
    f = float(raw)
    return int(f) if f.is_integer() and "." not in raw and "e" not in raw.lower() else f


class Parser:
    def __init__(self, tokens):
        self.t, self.i = tokens, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def take(self):
        tok = self.peek(); self.i += 1; return tok

    def expect(self, value):
        kind, raw = self.take()
        if raw != value:
            raise SyntaxError(f"expected {value!r}, got {raw!r} at token {self.i}")

    def parse_value(self):
        kind, raw = self.peek()
        if raw == "{":
            return self.parse_table()
        self.take()
        if kind == "str":
            return unquote(raw)
        if kind == "num":
            return to_number(raw)
        if kind == "name":
            if raw == "true":
                return True
            if raw == "false":
                return False
            if raw == "nil":
                return None
            raise SyntaxError(f"unexpected identifier {raw!r}")
        raise SyntaxError(f"unexpected token {raw!r}")

    def parse_table(self):
        self.expect("{")
        items, pairs = [], {}
        while True:
            kind, raw = self.peek()
            if raw == "}":
                self.take(); break
            if raw in (",", ";"):
                self.take(); continue
            # keyed entry: `name = value` or `["key"] = value`
            if kind == "name" and self.i + 1 < len(self.t) and self.t[self.i + 1][1] == "=":
                key = raw; self.take(); self.take()
                pairs[key] = self.parse_value()
            elif raw == "[":
                self.take()
                key_kind, key_raw = self.take()
                key = unquote(key_raw) if key_kind == "str" else to_number(key_raw)
                self.expect("]"); self.expect("=")
                pairs[str(key)] = self.parse_value()
            else:
                items.append(self.parse_value())
        if pairs and items:
            for n, item in enumerate(items, start=1):
                pairs[str(n)] = item
            return pairs
        return pairs if pairs else items


def parse_lua(src: str):
    tokens = tokenize(src)
    # Leading comments are stripped by the tokenizer, so the `return` that
    # opens every generated file is the first token, not the first characters.
    if tokens and tokens[0] == ("name", "return"):
        tokens = tokens[1:]
    return Parser(tokens).parse_value()


def main(argv):
    if len(argv) < 3:
        print("usage: lua_to_json.py <in.lua|in-dir> <out.json|out-dir>", file=sys.stderr)
        return 2
    src, dst = Path(argv[1]), Path(argv[2])
    if src.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for path in sorted(src.glob("*.lua")):
            data = parse_lua(path.read_text(encoding="utf-8"))
            out = dst / f"{path.stem}.json"
            out.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True,
                                      separators=(",", ":")), encoding="utf-8")
            print(f"{path.name} -> {out.name}  ({out.stat().st_size:,} bytes)")
    else:
        data = parse_lua(src.read_text(encoding="utf-8"))
        dst.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True,
                                  separators=(",", ":")), encoding="utf-8")
        print(f"{src.name} -> {dst.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
