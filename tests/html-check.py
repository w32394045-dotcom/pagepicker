#!/usr/bin/env python
"""PagePicker — HTML tag-pairing check using the standard library html.parser.

The Node static checker (tests/static-check.mjs) cannot spawn a child process under this
sandbox (spawn EPERM), so the required Python html.parser check lives in its own script:

    python tests/html-check.py                 # default: index.html
    python tests/html-check.py index.html src/index.template.html

Checks, per file:
  * every non-void element is closed, in the right order (stack-based)
  * no stray end tag
  * no element left open at EOF
  * reports tag counts + void elements seen
Exit code 0 = all files well-formed, 1 = at least one pairing problem.

Note: html.parser follows HTML's raw-text rules for <script>/<style>, so the inlined JS/CSS
cannot be mistaken for tags. Optional end tags (e.g. <li>, <p>) are not modelled; PagePicker's
markup is explicit, so any unclosed element here is a real problem.
"""
import sys
from html.parser import HTMLParser

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


class TagChecker(HTMLParser):
    def __init__(self, filename):
        super().__init__(convert_charrefs=True)
        self.filename = filename
        self.stack = []          # [(tag, (line, col))]
        self.problems = []       # human-readable strings
        self.tag_count = 0
        self.void_count = 0
        self.self_closed = 0
        self.max_depth = 0

    # html.parser lowercases tag names for us
    def handle_starttag(self, tag, attrs):
        self.tag_count += 1
        if tag in VOID:
            self.void_count += 1
            return
        self.stack.append((tag, self.getpos()))
        self.max_depth = max(self.max_depth, len(self.stack))

    def handle_startendtag(self, tag, attrs):
        # <path .../> — self-closing syntax handled explicitly
        self.tag_count += 1
        if tag in VOID:
            self.void_count += 1
        else:
            self.self_closed += 1

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        line = self.getpos()[0]
        if not self.stack:
            self.problems.append("line %d: unexpected </%s> (nothing is open)" % (line, tag))
            return
        open_tag, (open_line, _col) = self.stack.pop()
        if open_tag != tag:
            self.problems.append(
                "line %d: </%s> closes <%s> opened at line %d"
                % (line, tag, open_tag, open_line)
            )

    def finish(self):
        self.close()
        for tag, (line, _col) in self.stack:
            self.problems.append("line %d: <%s> is never closed" % (line, tag))


def check(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            source = fh.read()
    except OSError as exc:
        print("[%s] cannot read: %s" % (path, exc))
        return 1
    checker = TagChecker(path)
    try:
        checker.feed(source)
        checker.finish()
    except Exception as exc:  # pragma: no cover — parser crash is a finding too
        print("[%s] html.parser failed: %r" % (path, exc))
        return 1

    print("[%s]" % path)
    print("  tags: %d (void %d, self-closing %d), max depth %d, %d chars"
          % (checker.tag_count, checker.void_count, checker.self_closed,
             checker.max_depth, len(source)))
    # spot-check the shell the app depends on
    for needle, label in (
        ("<!doctype html>", "<!doctype html>"),
        ('<meta charset="utf-8"', 'meta charset="utf-8"'),
        ("</html>", "</html>"),
    ):
        if needle.lower() not in source.lower():
            checker.problems.append("missing %s" % label)
    if checker.problems:
        for problem in checker.problems:
            print("  \u2717 " + problem)
        return len(checker.problems)
    print("  \u2713 all tags paired (ignoring the %d void elements)" % checker.void_count)
    return 0


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    paths = argv[1:] or ["index.html", "src/index.template.html"]
    problems = 0
    for path in paths:
        problems += check(path)
    print()
    if problems:
        print("RESULT: FAIL (%d tag-pairing problem(s))" % problems)
        return 1
    print("RESULT: PASS (%d file(s) checked with html.parser)" % len(paths))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
