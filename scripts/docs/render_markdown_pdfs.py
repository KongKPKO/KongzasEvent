#!/usr/bin/env python3
"""Render repository Markdown documentation into indexed PDF archives."""

from __future__ import annotations

import html
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from textwrap import shorten

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf"
ARCHIVE = OUTPUT / "archive"
PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 18 * mm
CONTENT_WIDTH = PAGE_WIDTH - (2 * MARGIN)
PINK = colors.HexColor("#BE185D")
INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#4B5563")
PALE = colors.HexColor("#FDF2F8")
LINE = colors.HexColor("#E5E7EB")


def git_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() or "uncommitted"


def register_fonts() -> None:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Thonburi.ttc"),
    ]
    font_path = next((path for path in candidates if path.exists()), None)
    if font_path is None:
        raise RuntimeError("No Thai-capable font found")

    pdfmetrics.registerFont(TTFont("Doc", str(font_path)))
    pdfmetrics.registerFont(TTFont("DocBold", str(font_path)))
    pdfmetrics.registerFontFamily("Doc", normal="Doc", bold="DocBold")


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Doc",
            fontSize=9.2,
            leading=13.2,
            textColor=INK,
            spaceAfter=5,
            splitLongWords=True,
            wordWrap="CJK",
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="DocBold",
            fontSize=21,
            leading=26,
            textColor=PINK,
            spaceBefore=10,
            spaceAfter=10,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="DocBold",
            fontSize=15,
            leading=19,
            textColor=INK,
            spaceBefore=10,
            spaceAfter=6,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName="DocBold",
            fontSize=11.5,
            leading=15,
            textColor=colors.HexColor("#831843"),
            spaceBefore=7,
            spaceAfter=4,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "h4": ParagraphStyle(
            "H4",
            parent=base["Heading4"],
            fontName="DocBold",
            fontSize=9.5,
            leading=13,
            textColor=INK,
            spaceBefore=6,
            spaceAfter=3,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "list": ParagraphStyle(
            "List",
            parent=base["BodyText"],
            fontName="Doc",
            fontSize=9,
            leading=12.5,
            textColor=INK,
            leftIndent=12,
            firstLineIndent=-8,
            spaceAfter=3,
            splitLongWords=True,
            wordWrap="CJK",
        ),
        "quote": ParagraphStyle(
            "Quote",
            parent=base["BodyText"],
            fontName="Doc",
            fontSize=9,
            leading=13,
            textColor=MUTED,
            leftIndent=12,
            rightIndent=8,
            borderColor=PINK,
            borderWidth=0,
            borderPadding=6,
            backColor=PALE,
            spaceAfter=6,
            wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "Code",
            parent=base["Code"],
            fontName="Doc",
            fontSize=7.2,
            leading=9.5,
            textColor=colors.HexColor("#27272A"),
            leftIndent=7,
            rightIndent=7,
            borderPadding=7,
            backColor=colors.HexColor("#F4F4F5"),
            spaceBefore=3,
            spaceAfter=7,
        ),
        "table": ParagraphStyle(
            "TableCell",
            parent=base["BodyText"],
            fontName="Doc",
            fontSize=7.3,
            leading=9.5,
            textColor=INK,
            splitLongWords=True,
            wordWrap="CJK",
        ),
        "table_head": ParagraphStyle(
            "TableHead",
            parent=base["BodyText"],
            fontName="DocBold",
            fontSize=7.4,
            leading=9.5,
            textColor=colors.white,
            splitLongWords=True,
            wordWrap="CJK",
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base["Title"],
            fontName="DocBold",
            fontSize=28,
            leading=34,
            textColor=PINK,
            alignment=TA_LEFT,
            spaceAfter=16,
            wordWrap="CJK",
        ),
        "cover_meta": ParagraphStyle(
            "CoverMeta",
            parent=base["BodyText"],
            fontName="Doc",
            fontSize=10,
            leading=15,
            textColor=MUTED,
            wordWrap="CJK",
        ),
        "section": ParagraphStyle(
            "SectionTitle",
            parent=base["Title"],
            fontName="DocBold",
            fontSize=23,
            leading=29,
            textColor=INK,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
    }


STYLE = {}


def normalize_text(value: str) -> str:
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    value = re.sub(r"[\u200d\ufe0e\ufe0f\u20e3]", "", value)
    return (
        value.replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\ufeff", "")
    )


def inline_markup(value: str) -> str:
    value = normalize_text(value.strip())
    value = re.sub(r"<br\s*/?>", "@@LINE_BREAK@@", value, flags=re.IGNORECASE)
    value = html.escape(value)
    value = value.replace("@@LINE_BREAK@@", "<br/>")
    value = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        r'<link href="\2" color="#BE185D">\1</link>',
        value,
    )
    value = re.sub(r"`([^`]+)`", r'<font color="#9F1239">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"__([^_]+)__", r"<b>\1</b>", value)
    return value


def code_flowables(lines: list[str]) -> list[Preformatted]:
    # Small chunks let ReportLab move code safely before the footer.
    return [
        Preformatted("\n".join(lines[index : index + 8]), STYLE["code"], maxLineLength=105)
        for index in range(0, len(lines), 8)
    ]


def title_from_markdown(path: Path) -> str:
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("# "):
            return normalize_text(line[2:].strip())
    return normalize_text(path.stem.replace("-", " ").replace("_", " ").title())


def parse_table(lines: list[str]) -> Table:
    rows: list[list[Paragraph]] = []
    for row_index, line in enumerate(lines):
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells):
            continue
        style = STYLE["table_head"] if row_index == 0 else STYLE["table"]
        rows.append([Paragraph(inline_markup(cell), style) for cell in cells])

    column_count = max(len(row) for row in rows)
    for row in rows:
        row.extend(Paragraph("", STYLE["table"]) for _ in range(column_count - len(row)))

    widths = [CONTENT_WIDTH / column_count] * column_count
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PINK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.35, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
            ]
        )
    )
    return table


def markdown_flowables(path: Path, include_h1: bool = True) -> list:
    text = normalize_text(path.read_text(encoding="utf-8", errors="replace"))
    lines = text.splitlines()
    story: list = []
    paragraph: list[str] = []
    in_code = False
    code_lines: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            story.append(Paragraph(inline_markup(" ".join(paragraph)), STYLE["body"]))
            paragraph.clear()

    index = 0
    while index < len(lines):
        line = lines[index].rstrip()

        if line.startswith("```"):
            flush_paragraph()
            if in_code:
                code_lines = [line.replace("\t", "    ") for line in code_lines]
                story.extend(code_flowables(code_lines))
                code_lines.clear()
                in_code = False
            else:
                in_code = True
            index += 1
            continue

        if in_code:
            code_lines.append(line)
            index += 1
            continue

        if line.startswith("|") and "|" in line[1:]:
            flush_paragraph()
            table_lines = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index])
                index += 1
            if len(table_lines) >= 2:
                story.append(parse_table(table_lines))
                story.append(Spacer(1, 5))
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            if level == 1 and not include_h1:
                index += 1
                continue
            style_name = "h1" if level == 1 else "h2" if level == 2 else "h3" if level == 3 else "h4"
            story.append(Paragraph(inline_markup(heading.group(2)), STYLE[style_name]))
            index += 1
            continue

        if re.fullmatch(r"\s*[-*_]{3,}\s*", line):
            flush_paragraph()
            story.append(Spacer(1, 3))
            story.append(HRFlowable(width="100%", thickness=0.5, color=LINE))
            story.append(Spacer(1, 5))
            index += 1
            continue

        quote = re.match(r"^>\s?(.*)$", line)
        if quote:
            flush_paragraph()
            quote_lines = [quote.group(1)]
            index += 1
            while index < len(lines) and lines[index].startswith(">"):
                quote_lines.append(lines[index].lstrip("> "))
                index += 1
            story.append(Paragraph(inline_markup(" ".join(quote_lines)), STYLE["quote"]))
            continue

        bullet = re.match(r"^(\s*)[-*+]\s+(.*)$", line)
        numbered = re.match(r"^(\s*)(\d+)[.)]\s+(.*)$", line)
        checkbox = re.match(r"^(\s*)-\s+\[([ xX])\]\s+(.*)$", line)
        if checkbox or bullet or numbered:
            flush_paragraph()
            indent = len((checkbox or bullet or numbered).group(1)) // 2
            if checkbox:
                marker = "[x]" if checkbox.group(2).lower() == "x" else "[ ]"
                content = checkbox.group(3)
            elif numbered:
                marker = f"{numbered.group(2)}."
                content = numbered.group(3)
            else:
                marker = "-"
                content = bullet.group(2)
            style = ParagraphStyle(
                f"List{indent}",
                parent=STYLE["list"],
                leftIndent=12 + min(indent, 4) * 9,
            )
            story.append(Paragraph(f"{marker} {inline_markup(content)}", style))
            index += 1
            continue

        if not line.strip():
            flush_paragraph()
        else:
            paragraph.append(line.strip())
        index += 1

    flush_paragraph()
    if code_lines:
        story.extend(code_flowables(code_lines))
    return story


def page_decor(canvas, doc) -> None:
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 13 * mm, PAGE_WIDTH - MARGIN, 13 * mm)
    canvas.setFont("Doc", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 8.5 * mm, "NireQ Documentation")
    canvas.drawRightString(PAGE_WIDTH - MARGIN, 8.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def cover_flowables(title: str, subtitle: str, source_count: int) -> list:
    return [
        Spacer(1, 40 * mm),
        Paragraph("NIREQ", STYLE["h3"]),
        Paragraph(inline_markup(title), STYLE["cover_title"]),
        HRFlowable(width="38%", thickness=3, color=PINK, hAlign="LEFT"),
        Spacer(1, 8 * mm),
        Paragraph(inline_markup(subtitle), STYLE["cover_meta"]),
        Spacer(1, 4 * mm),
        Paragraph(
            f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} | Commit {git_sha()} | {source_count} source file(s)",
            STYLE["cover_meta"],
        ),
        Spacer(1, 55 * mm),
        Paragraph(
            "Repository-derived reference. Verify environment rollout separately from source implementation.",
            STYLE["cover_meta"],
        ),
        PageBreak(),
    ]


def render_book(output: Path, title: str, subtitle: str, sources: list[Path]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    story = cover_flowables(title, subtitle, len(sources))
    story.append(Paragraph("Contents", STYLE["h1"]))
    for number, source in enumerate(sources, 1):
        relative = source.relative_to(ROOT)
        story.append(Paragraph(f"{number}. {inline_markup(title_from_markdown(source))}", STYLE["body"]))
        story.append(Paragraph(inline_markup(str(relative)), STYLE["cover_meta"]))
    story.append(PageBreak())

    for number, source in enumerate(sources, 1):
        relative = source.relative_to(ROOT)
        story.extend(
            [
                Spacer(1, 48 * mm),
                Paragraph(f"Document {number} of {len(sources)}", STYLE["h3"]),
                Paragraph(inline_markup(title_from_markdown(source)), STYLE["section"]),
                Spacer(1, 8 * mm),
                Paragraph(inline_markup(str(relative)), STYLE["cover_meta"]),
                PageBreak(),
            ]
        )
        story.extend(markdown_flowables(source, include_h1=False))
        if number != len(sources):
            story.append(PageBreak())

    doc = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="NireQ",
    )
    doc.build(story, onFirstPage=page_decor, onLaterPages=page_decor)


def repository_markdown() -> list[Path]:
    blocked_parts = {
        ".git",
        ".claude",
        "node_modules",
        "KongzasEvent",
        "output",
        "tmp",
        ".playwright-mcp",
        ".impeccable",
        ".superpowers",
    }
    paths = []
    for path in ROOT.rglob("*.md"):
        relative = path.relative_to(ROOT)
        if any(part in blocked_parts for part in relative.parts):
            continue
        paths.append(path)
    return sorted(paths, key=lambda path: str(path.relative_to(ROOT)).lower())


def render_individuals(sources: list[Path]) -> None:
    for source in sources:
        relative = source.relative_to(ROOT).with_suffix(".pdf")
        output = ARCHIVE / relative
        render_book(
            output,
            title_from_markdown(source),
            f"Source: {source.relative_to(ROOT)}",
            [source],
        )


def validate_pdfs() -> tuple[int, int]:
    pdfs = sorted(OUTPUT.rglob("*.pdf"))
    pages = 0
    for pdf in pdfs:
        reader = PdfReader(str(pdf))
        if len(reader.pages) == 0:
            raise RuntimeError(f"PDF has no pages: {pdf}")
        pages += len(reader.pages)
    return len(pdfs), pages


def write_index(sources: list[Path], pdf_count: int, page_count: int) -> None:
    index_path = OUTPUT / "INDEX.txt"
    lines = [
        "NireQ PDF Documentation Index",
        "",
        f"Generated: {datetime.now().isoformat(timespec='minutes')}",
        f"Commit: {git_sha()}",
        f"Markdown sources: {len(sources)}",
        f"PDF files: {pdf_count}",
        f"Total pages: {page_count}",
        "",
        "Primary books:",
        "- NireQ_API_Handbook.pdf",
        "- NireQ_JIRA_Story_Spec_Catalog.pdf",
        "- NireQ_Design_Specs_Archive.pdf",
        "- NireQ_Implementation_Plans_Archive.pdf",
        "- NireQ_Project_Documentation_Archive.pdf",
        "- NireQ_All_Markdown_Archive.pdf",
        "",
        "Individual source PDFs are under archive/ using the repository path.",
    ]
    index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    global STYLE
    register_fonts()
    STYLE = styles()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ARCHIVE.mkdir(parents=True, exist_ok=True)

    sources = repository_markdown()
    api_sources = [
        ROOT / "docs/api/API-OVERVIEW.md",
        ROOT / "docs/api/API-REFERENCE.md",
        ROOT / "docs/api/API-EXAMPLES.md",
    ]
    story_sources = [ROOT / "docs/specs/JIRA-STORY-CATALOG.md"]
    design_sources = sorted((ROOT / "docs/superpowers/specs").glob("*.md"))
    plan_sources = sorted((ROOT / "docs/superpowers/plans").glob("*.md"))
    project_sources = sorted((ROOT / "Document").glob("*.md")) + [
        path
        for path in [ROOT / "PRODUCT.md", ROOT / "README.md", ROOT / "design-qa.md"]
        if path.exists()
    ]

    render_book(OUTPUT / "NireQ_API_Handbook.pdf", "NireQ API Handbook", "Architecture, reference, and copyable examples", api_sources)
    render_book(OUTPUT / "NireQ_JIRA_Story_Spec_Catalog.pdf", "NireQ JIRA-style Story & Spec Catalog", "Product stories, priorities, acceptance criteria, and source links", story_sources)
    render_book(OUTPUT / "NireQ_Design_Specs_Archive.pdf", "NireQ Design Specs Archive", "Complete dated design specifications", design_sources)
    render_book(OUTPUT / "NireQ_Implementation_Plans_Archive.pdf", "NireQ Implementation Plans Archive", "Complete dated implementation plans", plan_sources)
    render_book(OUTPUT / "NireQ_Project_Documentation_Archive.pdf", "NireQ Project Documentation Archive", "Product, architecture, operations, QA, and design documentation", project_sources)
    render_book(OUTPUT / "NireQ_All_Markdown_Archive.pdf", "NireQ Complete Markdown Archive", "All repository Markdown documentation in one searchable PDF", sources)
    render_individuals(sources)

    pdf_count, page_count = validate_pdfs()
    write_index(sources, pdf_count, page_count)
    print(f"Generated {pdf_count} PDFs ({page_count} pages) from {len(sources)} Markdown files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
