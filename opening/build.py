"""Make one self-contained opening.html: the scripts, the style and every picture inlined.

    python3 opening/build.py out/opening.html
"""

import base64
import pathlib
import re
import sys

here = pathlib.Path(__file__).parent
page = (here / "index.html").read_text()

page = page.replace(
    '<link rel="stylesheet" type="text/css" href="style.css">',
    "<style>\n" + (here / "style.css").read_text() + "</style>",
)

pictures = {}
for n in range(1, 23):
    pictures["../walk/frames/walk%02d.png" % n] = here / ("../walk/frames/walk%02d.png" % n)
for n in range(1, 50):
    pictures["title/title%02d.png" % n] = here / ("title/title%02d.png" % n)
inline = ",\n".join(
    '"%s": "data:image/png;base64,%s"' % (k, base64.b64encode(v.read_bytes()).decode())
    for k, v in pictures.items()
)


def script(m):
    src = m.group(1)
    if src.startswith("http"):
        return m.group(0)
    return "<script>\n" + (here / src).read_text() + "</script>"


page = re.sub(r'<script src="([^"]+)"></script>', script, page)
page = page.replace("<body>", "<body>\n    <script>window.INLINE = {\n" + inline + "};</script>", 1)

# published as an artifact, the page is wrapped in its own document, so only what's inside goes
page = re.sub(r"<!DOCTYPE html>|</?html[^>]*>|</?head>|</?body>|<meta [^>]*>", "", page)

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "opening.html")
out.write_text(page)
print(out, len(page) // 1024, "KB")
