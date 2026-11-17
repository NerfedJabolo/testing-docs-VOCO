#!/usr/bin/env python3
"""Koostab Markdown-dokumendist Google Docsesse imporditava DOCX-faili.

Kasutab LibreOffice'i HTML -> DOCX teisendust, seejärel manustab pildid
DOCX-paketti ja lisab lehejaluse. Skript on mõeldud selle konkreetse
dokumendi jaoks, kuid töötab ka sarnase struktuuriga Markdown-failidega.
"""

from __future__ import annotations

import html
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse

from PIL import Image, ImageChops

DOCS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = DOCS_DIR.parent
SOURCE = DOCS_DIR / "TESTIMISE_DOKUMENTATSIOON.md"
BUILD_DIR = DOCS_DIR / "build"
HTML_FILE = BUILD_DIR / "document.html"
RAW_DOCX = BUILD_DIR / "document-raw.docx"
FINAL_DOCX = DOCS_DIR / "TESTIMISE_DOKUMENTATSIOON.docx"
TABLE_WIDTHS: list[list[int]] = []
CROPPED_IMAGES: dict[str, Path] = {}
APPENDIX_A_HEADER = (
    "ID", "Valdkond", "Testjuhtum", "Oodatud tulemus", "Tegelik tulemus", "Staatus"
)


def crop_figures() -> None:
    """Lõikab ekraanipiltidelt tühja tausta, säilitades originaalfailid."""
    figures_dir = BUILD_DIR / "figures"
    figures_dir.mkdir(parents=True, exist_ok=True)
    CROPPED_IMAGES.clear()
    markdown = SOURCE.read_text(encoding="utf-8")
    for match in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", markdown):
        relative = match.group(1)
        source = (DOCS_DIR / relative).resolve()
        if not source.exists() or relative in CROPPED_IMAGES:
            continue
        target = figures_dir / (source.stem + "-crop" + source.suffix)
        try:
            image = Image.open(source).convert("RGB")
            background = Image.new("RGB", image.size, "white")
            bbox = ImageChops.difference(image, background).getbbox()
            if bbox:
                margin = 18
                left = max(0, bbox[0] - margin)
                top = max(0, bbox[1] - margin)
                right = min(image.width, bbox[2] + margin)
                bottom = min(image.height, bbox[3] + margin)
                image.crop((left, top, right, bottom)).save(target)
            else:
                shutil.copyfile(source, target)
            CROPPED_IMAGES[relative] = target
        except Exception as error:  # noqa: BLE001 - kuvame hoiatuse ja kasutame originaali
            print(f"Hoiatus: pildi {source} lõikamine ebaõnnestus: {error}", file=sys.stderr)


def display_size(path: Path, max_width_cm: float = 14.0, max_height_cm: float = 7.5) -> tuple[float, float]:
    """Arvutab pildi kuvamõõdud, säilitades originaali proportsioonid."""
    width_px = height_px = None
    try:
        data = path.read_bytes()[:24]
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            width_px, height_px = struct.unpack(">II", data[16:24])
    except OSError:
        pass
    if not width_px or not height_px:
        return max_width_cm, max_height_cm * 0.75
    width_cm = width_px / 96 * 2.54
    height_cm = height_px / 96 * 2.54
    scale = min(max_width_cm / width_cm, max_height_cm / height_cm, 1.0)
    return width_cm * scale, height_cm * scale


def inline(text: str) -> str:
    """Teisendab ühe rea inline-Markdowni HTML-iks."""
    text = html.escape(text, quote=False)

    code_spans: list[str] = []

    def hide_code(match: re.Match[str]) -> str:
        code_spans.append(match.group(1))
        return f"\x00CODE{len(code_spans) - 1}\x00"

    text = re.sub(r"`([^`]+)`", hide_code, text)

    def image_tag(match: re.Match[str]) -> str:
        alt, src = match.group(1), match.group(2)
        absolute = CROPPED_IMAGES.get(src, (DOCS_DIR / src).resolve())
        width_cm, height_cm = display_size(absolute)
        return (
            f'<img src="{absolute.as_uri()}" alt="{alt}" '
            f'style="width: {width_cm:.2f}cm; height: {height_cm:.2f}cm;" />'
        )

    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", image_tag, text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)

    for index, code in enumerate(code_spans):
        text = text.replace(f"\x00CODE{index}\x00", f"<code>{code}</code>")

    return text


def is_table_separator(line: str) -> bool:
    return bool(re.fullmatch(r"\|[\s:|-]+\|", line.strip()))


def split_table_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def column_widths(header: list[str]) -> list[int]:
    """Annab tabeli veerulaiused protsentides, et vältida lehe serva ületamist."""
    signature = tuple(header)
    rules: dict[tuple[str, ...], list[int]] = {
        ("Väli", "Väärtus"): [26, 74],
        ("Komponent", "Väärtus"): [26, 74],
        ("Fail", "Sisu"): [40, 60],
        ("Ressurss", "Väärtus"): [28, 72],
        ("Roll", "Vastutus selles projektis"): [26, 74],
        ("Üldeesmärk", "Konkreetne tähendus selles projektis"): [26, 74],
        ("Moodul", "Failid", "Funktsioon", "Testimise perspektiiv"): [12, 22, 28, 38],
        ("Kriteerium", "Sihttase", "Tegelik tulemus", "Staatus"): [30, 12, 42, 16],
        ("Valdkond", "Testjuhtumid", "PASS", "FAIL", "Peamine järeldus"): [14, 18, 8, 8, 52],
        ("ID", "Omadus", "Kontroll", "Tulemus"): [9, 18, 18, 55],
        ("Üksus", "Kontrollitud harud", "Harukatvus", "Leitud probleem"): [13, 38, 19, 30],
        ("Rajapind", "Komponendid", "Kontroll", "Tulemus"): [12, 32, 30, 26],
        ("Stsenaarium", "Sammud", "Testjuhtumid", "Tulemus"): [22, 34, 18, 26],
        ("ID", "Kontroll", "Tulemus", "Detail"): [8, 26, 10, 56],
        ("Etapp", "Tegevus", "Väljund"): [20, 38, 42],
        ("Risk", "Tõenäosus", "Mõju", "Maandus"): [16, 15, 12, 57],
        ("Valdkond", "Kaetud", "Testjuhtumid"): [38, 14, 48],
        ("Valdkond", "Põhjus"): [40, 60],
        ("Tasand / tüüp", "Tehnika", "Tööriist", "Testjuhtumid"): [14, 30, 22, 34],
        ("Andmeklass", "Väärtused", "Kasutus"): [24, 48, 28],
        ("Jooks", "Aeg (Europe/Tallinn)", "Kontrollid", "PASS/FAIL/ERROR", "Kestus", "Märkus"): [8, 20, 10, 18, 10, 34],
        ("Jooks", "Kuupäev ja aeg", "Keskkond", "PASS/FAIL/ERROR", "Kestus", "Fail"): [8, 20, 24, 16, 10, 22],
        ("Valdkond", "Testjuhtumid", "PASS", "FAIL", "Passimäär"): [40, 24, 9, 9, 18],
        ("Tõsidus", "Arv", "Defektid"): [14, 8, 78],
        ("Kriteerium", "Tulemus", "Hinnang"): [38, 24, 38],
        ("Otstarve", "Valmis?", "Tingimus"): [28, 14, 58],
        ("Prioriteet", "Soovitus", "Seotud defekt"): [12, 70, 18],
        ("Tööriist / tehnoloogia", "Versioon", "Roll"): [30, 14, 56],
        ("Malli tööriist", "Kasutati?", "Põhjendus"): [22, 14, 64],
        ("Praktika", "Kuidas rakendati", "Tõend"): [24, 50, 26],
        ("Praktika", "Miks ei rakendatud", "Soovitus"): [24, 40, 36],
        ("ID", "Valdkond", "Testjuhtum", "Oodatud tulemus", "Tegelik tulemus", "Staatus"): [8, 12, 21, 24, 25, 10],
        ("Nõue", "Kirjeldus", "Testjuhtumid", "Seis"): [8, 40, 34, 18],
        ("ID", "Väärtus", "Kasutus"): [8, 62, 30],
        ("Roll", "Nimi", "Kuupäev", "Allkiri"): [30, 20, 20, 30],
    }
    if signature in rules:
        return rules[signature]

    count = len(header)
    first = header[0] if header else ""
    if count == 2:
        return [30, 70]
    if count == 3:
        if first == "Tõsidus":
            return [12, 8, 80]
        if first == "ID":
            return [10, 28, 62]
        return [20, 25, 55]
    if count == 4:
        if first == "ID":
            return [7, 26, 12, 55]
        if first == "Stsenaarium":
            return [22, 30, 20, 28]
        if first == "Rajapind":
            return [8, 30, 36, 26]
        if first == "Nõue":
            return [8, 42, 32, 18]
        if first == "Moodul":
            return [10, 20, 30, 40]
        return [15, 25, 30, 30]
    if count == 5:
        return [14, 18, 8, 8, 52]
    if count == 6:
        return [6, 9, 22, 26, 27, 10]
    return [round(100 / count, 2)] * count


def convert(markdown: str) -> str:
    TABLE_WIDTHS.clear()
    lines = markdown.splitlines()
    out: list[str] = []
    paragraph: list[str] = []
    table_count = 0

    def flush_paragraph() -> None:
        if paragraph:
            out.append("<p>" + inline(" ".join(paragraph)) + "</p>")
            paragraph.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            flush_paragraph()
            i += 1
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            language = stripped[3:].strip()
            i += 1
            code_lines: list[str] = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1
            code = html.escape("\n".join(code_lines), quote=False)
            class_attr = f' class="language-{html.escape(language)}"' if language else ""
            out.append(f"<pre><code{class_attr}>{code}</code></pre>")
            continue

        image_only = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", stripped)
        if image_only:
            flush_paragraph()
            caption = ""
            if out and out[-1].startswith("<p><strong>Joonis"):
                caption = out.pop()
            out.append('<div class="figure">' + inline(stripped) + caption + "</div>")
            i += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            content = inline(heading.group(2))
            extra = ""
            if level == 2 and content.startswith("1. Sissejuhatus"):
                extra = ' class="section-start"'
            if level in (3, 4) and content.startswith("4.4.2."):
                extra = ' class="break-before"'
            out.append(f"<h{level}{extra}>{content}</h{level}>")
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and is_table_separator(lines[i + 1]):
            flush_paragraph()
            header = split_table_row(lines[i])
            i += 2
            rows: list[list[str]] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if not is_table_separator(lines[i]):
                    rows.append(split_table_row(lines[i]))
                i += 1
            table_count += 1
            widths = column_widths(header)
            TABLE_WIDTHS.append(widths)
            keep = len(rows) <= 12
            out.append('<table class="keep">' if keep else "<table>")
            out.append("<colgroup>")
            for width in widths:
                out.append(f'<col style="width: {width}%" />')
            out.append("</colgroup>")
            out.append("<thead><tr>")
            for cell in header:
                out.append(f"<th>{inline(cell)}</th>")
            out.append("</tr></thead><tbody>")
            for row in rows:
                out.append("<tr>")
                for cell in row:
                    cell_value = cell
                    if tuple(header) == APPENDIX_A_HEADER:
                        cell_value = {
                            "Mittefunktsionaalne": "Mittefunkts.",
                            "Integratsioon": "Integr.",
                        }.get(cell_value, cell_value)
                    out.append(f"<td>{inline(cell_value)}</td>")
                out.append("</tr>")
            out.append("</tbody></table>")
            continue

        if re.match(r"^---+$", stripped):
            flush_paragraph()
            out.append("<hr />")
            i += 1
            continue

        if stripped.startswith("> "):
            flush_paragraph()
            quote_lines: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip()[1:].strip())
                i += 1
            out.append("<blockquote><p>" + inline(" ".join(quote_lines)) + "</p></blockquote>")
            continue

        bullet = re.match(r"^[-*]\s+(.*)$", line)
        if bullet:
            flush_paragraph()
            items: list[str] = []
            while i < len(lines):
                match = re.match(r"^[-*]\s+(.*)$", lines[i])
                if not match:
                    break
                items.append(match.group(1))
                i += 1
            out.append("<ul>")
            for item in items:
                out.append(f"<li>{inline(item)}</li>")
            out.append("</ul>")
            continue

        numbered = re.match(r"^(\d+)\.\s+(.*)$", line)
        if numbered:
            flush_paragraph()
            start_number = int(numbered.group(1))
            items = []
            while i < len(lines):
                match = re.match(r"^(\d+)\.\s+(.*)$", lines[i])
                if not match:
                    break
                items.append(match.group(2))
                i += 1
            out.append(f'<ol start="{start_number}">' if start_number != 1 else "<ol>")
            for item in items:
                out.append(f"<li>{inline(item)}</li>")
            out.append("</ol>")
            continue

        paragraph.append(stripped)
        i += 1

    flush_paragraph()
    return "\n".join(out)


CSS = """
@page { size: A4; margin: 2cm 1.8cm; }
body {
  font-family: Arial, "Liberation Sans", sans-serif;
  font-size: 10.5pt;
  line-height: 1.35;
  color: #1f2937;
  margin: 0;
}
h1 {
  font-size: 24pt;
  line-height: 1.15;
  color: #0f3d5e;
  border-bottom: 2pt solid #0f3d5e;
  padding-bottom: 6pt;
  margin: 0 0 14pt 0;
}
h2 {
  font-size: 16pt;
  color: #0f3d5e;
  margin: 20pt 0 8pt 0;
  page-break-after: avoid;
}
h3 {
  font-size: 12.5pt;
  color: #14532d;
  margin: 14pt 0 5pt 0;
  page-break-after: avoid;
}
h4 {
  font-size: 11pt;
  color: #1f2937;
  margin: 12pt 0 4pt 0;
  page-break-after: avoid;
}
p { margin: 0 0 6pt 0; }
ul, ol { margin: 0 0 7pt 0; padding-left: 18pt; }
li { margin: 0 0 2pt 0; }
strong { color: #111827; }
code {
  font-family: "DejaVu Sans Mono", "Courier New", monospace;
  font-size: 8.7pt;
  background-color: #f3f4f6;
  color: #7c2d12;
}
pre {
  font-family: "DejaVu Sans Mono", "Courier New", monospace;
  font-size: 8.3pt;
  background-color: #f3f4f6;
  border: 0.5pt solid #d1d5db;
  padding: 6pt;
  white-space: pre-wrap;
  margin: 0 0 8pt 0;
}
pre code { background: transparent; color: #111827; }
blockquote {
  border-left: 3pt solid #9aa7b4;
  margin: 8pt 0;
  padding: 4pt 8pt;
  background-color: #f8fafc;
  color: #374151;
}
hr {
  border: none;
  border-top: 0.5pt solid #cbd5e1;
  margin: 10pt 0;
}
table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  margin: 6pt 0 10pt 0;
  font-size: 8.2pt;
  line-height: 1.25;
}
table.keep { page-break-inside: avoid; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th {
  background-color: #e8eef5;
  color: #0f3d5e;
  border: 0.5pt solid #9aa7b4;
  padding: 3pt 4pt;
  text-align: left;
  vertical-align: top;
  font-weight: bold;
}
td {
  border: 0.5pt solid #b8c2cc;
  padding: 3pt 4pt;
  vertical-align: top;
  overflow-wrap: break-word;
  word-wrap: break-word;
}
th {
  overflow-wrap: break-word;
  word-wrap: break-word;
}
td code, th code { font-size: 7.8pt; }
img {
  display: block;
  margin: 6pt auto;
  border: 0.5pt solid #cbd5e1;
  page-break-inside: avoid;
}
.figure {
  page-break-inside: avoid;
  margin: 10pt 0 12pt 0;
}
.figure p {
  text-align: center;
  font-size: 9pt;
  color: #4b5563;
  margin: 4pt 0 0 0;
}
a { color: #0f5e9c; text-decoration: underline; }
.section-start { page-break-before: always; }
.break-before { page-break-before: always; }
"""


def build_html() -> None:
    markdown = SOURCE.read_text(encoding="utf-8")
    body = convert(markdown)
    document = f"""<!DOCTYPE html>
<html lang="et">
<head>
<meta charset="utf-8" />
<title>box-testing-master — testimise dokumentatsioon</title>
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>
"""
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    HTML_FILE.write_text(document, encoding="utf-8")


def run_libreoffice() -> None:
    if RAW_DOCX.exists():
        RAW_DOCX.unlink()
    command = [
        "soffice",
        "-env:UserInstallation=file:///tmp/lo-profile",
        "--headless",
        "--convert-to",
        "docx:Office Open XML Text",
        "--outdir",
        str(BUILD_DIR),
        str(HTML_FILE),
    ]
    environment = os.environ.copy()
    environment["HOME"] = "/tmp"
    result = subprocess.run(
        command,
        check=False,
        env=environment,
        capture_output=True,
        text=True,
    )
    produced = BUILD_DIR / (HTML_FILE.stem + ".docx")
    if result.returncode != 0 or not produced.exists():
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit("LibreOffice'i teisendus ebaõnnestus.")
    produced.replace(RAW_DOCX)


def read_members(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def write_members(path: Path, members: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)


def embed_images(members: dict[str, bytes]) -> None:
    document = members["word/document.xml"].decode("utf-8")
    rels = members["word/_rels/document.xml.rels"].decode("utf-8")

    linked_ids = re.findall(r'r:link="(rId\d+)"', document)
    if not linked_ids:
        return

    content_types = members["[Content_Types].xml"].decode("utf-8")
    image_number = 1

    for relation_id in dict.fromkeys(linked_ids):
        relation_pattern = re.compile(
            r'<Relationship[^>]*Id="' + re.escape(relation_id) + r'"[^>]*/>'
        )
        match = relation_pattern.search(rels)
        if not match:
            continue
        relation = match.group(0)
        target_match = re.search(r'Target="([^"]+)"', relation)
        if not target_match:
            continue
        target = target_match.group(1)
        if not target.startswith("file://"):
            continue

        source_path = Path(unquote(urlparse(target).path))
        if not source_path.exists():
            continue

        extension = source_path.suffix.lower().lstrip(".") or "png"
        media_name = f"image{image_number}.{extension}"
        members[f"word/media/{media_name}"] = source_path.read_bytes()

        new_relation = re.sub(r'\s+Target="[^"]+"', f' Target="media/{media_name}"', relation)
        new_relation = new_relation.replace(' TargetMode="External"', "")
        rels = rels.replace(relation, new_relation)
        document = document.replace(f'r:link="{relation_id}"', f'r:embed="{relation_id}"')
        image_number += 1

        if f'Extension="{extension}"' not in content_types:
            content_types = content_types.replace(
                "</Types>",
                f'<Default Extension="{extension}" ContentType="image/{extension}"/></Types>',
            )

    members["word/document.xml"] = document.encode("utf-8")
    members["word/_rels/document.xml.rels"] = rels.encode("utf-8")
    members["[Content_Types].xml"] = content_types.encode("utf-8")


def prevent_row_splits(members: dict[str, bytes]) -> None:
    """Keelab tabeliridade poolitamise lehekülgede vahel."""
    document = members["word/document.xml"].decode("utf-8")

    def add_cant_split(match: re.Match[str]) -> str:
        block = match.group(0)
        if "<w:cantSplit" in block:
            return block
        if "<w:trPr>" in block:
            return block.replace("<w:trPr>", "<w:trPr><w:cantSplit/>", 1)
        return block.replace("<w:tr>", "<w:tr><w:trPr><w:cantSplit/></w:trPr>", 1)

    document = re.sub(r"<w:tr>.*?</w:tr>", add_cant_split, document, flags=re.S)
    members["word/document.xml"] = document.encode("utf-8")


def normalize_tables(members: dict[str, bytes], widths_by_table: list[list[int]]) -> None:
    """Sunnib DOCX-tabelid lehe sisulaiusesse ja eemaldab LibreOffice'i liigsed laiused."""
    document = members["word/document.xml"].decode("utf-8")
    content_width = 9500  # A4 21 cm - 2 x 2 cm veeris, twipides
    tables = list(re.finditer(r"<w:tbl>.*?</w:tbl>", document, re.S))
    if len(tables) != len(widths_by_table):
        # Kui tabelite arv ei klapi, kasutame ühtlaseid laiusi.
        print(
            f"Hoiatus: DOCX-tabeleid {len(tables)}, laiusi {len(widths_by_table)}; "
            "kasutan ühtlaseid laiusi.",
            file=sys.stderr,
        )

    parts: list[str] = []
    last = 0
    for index, match in enumerate(tables):
        block = match.group(0)
        if index < len(widths_by_table):
            widths = widths_by_table[index]
        else:
            grid_count = len(re.findall(r"<w:gridCol\b", block))
            widths = [round(100 / max(grid_count, 1), 2)] * max(grid_count, 1)

        parts.append(document[last:match.start()])
        block = re.sub(
            r'<w:tblW w:w="\d+" w:type="dxa"/>',
            f'<w:tblW w:w="{content_width}" w:type="dxa"/>',
            block,
            count=1,
        )
        grid_count = len(re.findall(r"<w:gridCol\b", block))
        widths = (widths + [round(100 / max(grid_count, 1), 2)] * grid_count)[:grid_count]
        total = sum(widths) or 100
        normalized = [round(content_width * width / total) for width in widths]
        # Ümardamisjääk lisatakse viimasele veerule.
        normalized[-1] += content_width - sum(normalized)

        grid_index = 0

        def replace_grid_col(col_match: re.Match[str]) -> str:
            nonlocal grid_index
            value = normalized[grid_index] if grid_index < len(normalized) else normalized[-1]
            grid_index += 1
            return f'<w:gridCol w:w="{value}"/>'

        block = re.sub(r'<w:gridCol w:w="\d+"/>', replace_grid_col, block)

        cell_index = 0

        def replace_cell_width(cell_match: re.Match[str]) -> str:
            nonlocal cell_index
            value = normalized[cell_index % len(normalized)]
            cell_index += 1
            return f'<w:tcW w:w="{value}" w:type="dxa"/>'

        block = re.sub(r'<w:tcW w:w="\d+" w:type="dxa"/>', replace_cell_width, block)
        parts.append(block)
        last = match.end()
    parts.append(document[last:])
    members["word/document.xml"] = "".join(parts).encode("utf-8")


FOOTER_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="0" w:after="0"/>
    </w:pPr>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr>
      <w:t xml:space="preserve">box-testing-master — testimise dokumentatsioon  |  lk </w:t>
    </w:r>
    <w:fldSimple w:instr=" PAGE ">
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>1</w:t></w:r>
    </w:fldSimple>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr>
      <w:t xml:space="preserve"> / </w:t>
    </w:r>
    <w:fldSimple w:instr=" NUMPAGES ">
      <w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>1</w:t></w:r>
    </w:fldSimple>
  </w:p>
</w:ftr>
"""


def add_footer(members: dict[str, bytes]) -> None:
    document = members["word/document.xml"].decode("utf-8")
    rels = members["word/_rels/document.xml.rels"].decode("utf-8")
    content_types = members["[Content_Types].xml"].decode("utf-8")

    if "footerReference" in document:
        return

    existing_ids = [int(value) for value in re.findall(r'Id="rId(\d+)"', rels)]
    footer_id = f"rId{max(existing_ids, default=0) + 1}"

    rels = rels.replace(
        "</Relationships>",
        f'<Relationship Id="{footer_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
    )
    content_types = content_types.replace(
        "</Types>",
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
    )

    members["word/footer1.xml"] = FOOTER_XML.encode("utf-8")
    document = re.sub(
        r"(<w:sectPr[^>]*>)",
        r"\1" + f'<w:footerReference w:type="default" r:id="{footer_id}"/>',
        document,
        count=1,
    )
    members["word/document.xml"] = document.encode("utf-8")
    members["word/_rels/document.xml.rels"] = rels.encode("utf-8")
    members["[Content_Types].xml"] = content_types.encode("utf-8")


def fix_page_layout(members: dict[str, bytes]) -> None:
    document = members["word/document.xml"].decode("utf-8")
    document = re.sub(
        r"<w:pgMar[^/]*/>",
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>',
        document,
    )
    document = re.sub(
        r"<w:pgSz[^/]*/>",
        '<w:pgSz w:w="11906" w:h="16838"/>',
        document,
    )
    members["word/document.xml"] = document.encode("utf-8")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Lähtefail puudub: {SOURCE}")
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    crop_figures()
    build_html()
    run_libreoffice()

    members = read_members(RAW_DOCX)
    embed_images(members)
    normalize_tables(members, TABLE_WIDTHS)
    prevent_row_splits(members)
    add_footer(members)
    fix_page_layout(members)
    write_members(FINAL_DOCX, members)

    with zipfile.ZipFile(FINAL_DOCX) as archive:
        bad = archive.testzip()
        if bad:
            raise SystemExit(f"DOCX-pakett on rikkis: {bad}")
        media = [name for name in archive.namelist() if name.startswith("word/media/")]

    print(f"Loodud: {FINAL_DOCX}")
    print(f"Manustatud pilte: {len(media)}")
    print(f"Suurus: {FINAL_DOCX.stat().st_size} baiti")


if __name__ == "__main__":
    main()
