#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import html
import os
import shutil
import zipfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT_DOCX = ROOT / "docs" / "Bai_Giang_Sonic_Math_Runner_Cap2.docx"
BUILD_DIR = ROOT / ".runtime" / "lesson-docx-build"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"

TWIPS_PER_INCH = 1440
CONTENT_WIDTH_DXA = 9360
TABLE_INDENT_DXA = 120


def esc(value):
    return html.escape(str(value), quote=True)


def ensure_dirs():
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    for rel in [
        "_rels",
        "docProps",
        "word",
        "word/_rels",
        "word/media",
    ]:
        (BUILD_DIR / rel).mkdir(parents=True, exist_ok=True)


def write(rel_path, text):
    path = BUILD_DIR / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class DocBuilder:
    def __init__(self):
        self.parts = []
        self.rels = []
        self.next_rid = 5
        self.image_index = 1

    def add_paragraph(self, text="", style="Normal", runs=None, num_id=None, level=0, keep_next=False):
        ppr = []
        if style:
            ppr.append(f'<w:pStyle w:val="{esc(style)}"/>')
        if keep_next:
            ppr.append("<w:keepNext/>")
        if num_id is not None:
            ppr.append(
                "<w:numPr>"
                f'<w:ilvl w:val="{level}"/>'
                f'<w:numId w:val="{num_id}"/>'
                "</w:numPr>"
            )
        if ppr:
            self.parts.append("<w:p><w:pPr>" + "".join(ppr) + "</w:pPr>")
        else:
            self.parts.append("<w:p>")

        if runs is None:
            runs = [(text, {})]

        for run_text, props in runs:
            self.parts.append(self.run(run_text, props))
        self.parts.append("</w:p>")

    def run(self, text, props=None):
        props = props or {}
        rpr = []
        if props.get("bold"):
            rpr.append("<w:b/>")
        if props.get("italic"):
            rpr.append("<w:i/>")
        if props.get("color"):
            rpr.append(f'<w:color w:val="{props["color"]}"/>')
        if props.get("size"):
            rpr.append(f'<w:sz w:val="{int(props["size"] * 2)}"/>')
            rpr.append(f'<w:szCs w:val="{int(props["size"] * 2)}"/>')
        if props.get("font"):
            font = esc(props["font"])
            rpr.append(f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:cs="{font}"/>')
        if props.get("highlight"):
            rpr.append(f'<w:highlight w:val="{esc(props["highlight"])}"/>')

        rpr_xml = f"<w:rPr>{''.join(rpr)}</w:rPr>" if rpr else ""
        return f"<w:r>{rpr_xml}<w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r>"

    def add_heading(self, text, level=1):
        self.add_paragraph(text, style=f"Heading{level}", keep_next=True)

    def add_bullet(self, text):
        self.add_paragraph(text, style="ListParagraph", num_id=1, level=0)

    def add_number(self, text):
        self.add_paragraph(text, style="ListParagraph", num_id=2, level=0)

    def add_code(self, lines):
        if isinstance(lines, str):
            lines = lines.splitlines()
        for line in lines:
            self.add_paragraph(line, style="CodeBlock")

    def add_callout(self, title, body):
        self.add_table(
            [["", title + "\n" + body]],
            widths=[420, CONTENT_WIDTH_DXA - 420],
            style="CalloutTable",
            shade_first_col=True,
        )

    def add_table(self, rows, widths=None, style="LessonTable", shade_first_col=False):
        if not rows:
            return
        col_count = max(len(row) for row in rows)
        if widths is None:
            widths = [int(CONTENT_WIDTH_DXA / col_count)] * col_count
        grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
        self.parts.append(
            "<w:tbl>"
            "<w:tblPr>"
            f'<w:tblStyle w:val="{style}"/>'
            f'<w:tblW w:w="{CONTENT_WIDTH_DXA}" w:type="dxa"/>'
            f'<w:tblInd w:w="{TABLE_INDENT_DXA}" w:type="dxa"/>'
            '<w:tblLayout w:type="fixed"/>'
            '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/>'
            '<w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>'
            "</w:tblPr>"
            f"<w:tblGrid>{grid}</w:tblGrid>"
        )
        for row_index, row in enumerate(rows):
            self.parts.append("<w:tr>")
            for col_index in range(col_count):
                value = row[col_index] if col_index < len(row) else ""
                shade = row_index == 0 or (shade_first_col and col_index == 0)
                fill = "E8EEF5" if row_index == 0 else ("F4F6F9" if shade else None)
                tcpr = [
                    f'<w:tcW w:w="{widths[col_index]}" w:type="dxa"/>',
                    '<w:vAlign w:val="center"/>',
                ]
                if fill:
                    tcpr.append(f'<w:shd w:fill="{fill}"/>')
                self.parts.append("<w:tc><w:tcPr>" + "".join(tcpr) + "</w:tcPr>")
                paragraphs = str(value).split("\n")
                for idx, paragraph_text in enumerate(paragraphs):
                    cell_style = "TableHeader" if row_index == 0 else "TableBody"
                    if shade_first_col and col_index == 0 and row_index > 0:
                        cell_style = "TableLabel"
                    self.parts.append(
                        f'<w:p><w:pPr><w:pStyle w:val="{cell_style}"/></w:pPr>'
                        + self.run(paragraph_text, {"bold": row_index == 0 or (shade_first_col and col_index == 0)})
                        + "</w:p>"
                    )
                    if idx == len(paragraphs) - 1 and paragraph_text == "":
                        self.parts.append("<w:p/>")
                self.parts.append("</w:tc>")
            self.parts.append("</w:tr>")
        self.parts.append("</w:tbl>")

    def add_image(self, path, caption, width_in=5.9):
        path = ROOT / path
        if not path.exists():
            return
        image_name = f"image{self.image_index}{path.suffix.lower()}"
        self.image_index += 1
        shutil.copyfile(path, BUILD_DIR / "word" / "media" / image_name)
        rid = f"rId{self.next_rid}"
        self.next_rid += 1
        self.rels.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{image_name}"/>'
        )
        with Image.open(path) as im:
            width_px, height_px = im.size
        cx = int(width_in * 914400)
        cy = int(cx * height_px / width_px)
        doc_pr_id = self.image_index + 100
        self.parts.append(
            '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="80"/></w:pPr><w:r><w:drawing>'
            '<wp:inline distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{cx}" cy="{cy}"/>'
            '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
            f'<wp:docPr id="{doc_pr_id}" name="{esc(caption)}"/>'
            '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic><pic:nvPicPr>'
            f'<pic:cNvPr id="{doc_pr_id}" name="{esc(image_name)}"/>'
            '<pic:cNvPicPr/>'
            '</pic:nvPicPr><pic:blipFill>'
            f'<a:blip r:embed="{rid}"/>'
            '<a:stretch><a:fillRect/></a:stretch>'
            '</pic:blipFill><pic:spPr>'
            '<a:xfrm><a:off x="0" y="0"/>'
            f'<a:ext cx="{cx}" cy="{cy}"/>'
            '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
            '</pic:spPr></pic:pic>'
            '</a:graphicData></a:graphic>'
            '</wp:inline></w:drawing></w:r></w:p>'
        )
        self.add_paragraph(caption, style="Caption")

    def page_break(self):
        self.parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')

    def document_xml(self):
        body = "".join(self.parts)
        sect = (
            "<w:sectPr>"
            '<w:headerReference w:type="default" r:id="rId3"/>'
            '<w:footerReference w:type="default" r:id="rId4"/>'
            '<w:pgSz w:w="12240" w:h="15840"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>'
            '<w:cols w:space="720"/>'
            '<w:docGrid w:linePitch="360"/>'
            "</w:sectPr>"
        )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}" xmlns:wp="{WP_NS}" xmlns:a="{A_NS}" xmlns:pic="{PIC_NS}">'
            f"<w:body>{body}{sect}</w:body></w:document>"
        )


def styles_xml():
    def style(style_id, name, based_on="Normal", ppr="", rpr=""):
        based = f'<w:basedOn w:val="{based_on}"/>' if based_on else ""
        return (
            f'<w:style w:type="paragraph" w:styleId="{style_id}">'
            f'<w:name w:val="{name}"/>{based}<w:qFormat/>'
            f"<w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>"
        )

    calibri = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
    courier = '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>'
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:styles xmlns:w="{W_NS}">'
        '<w:docDefaults><w:rPrDefault><w:rPr>'
        f'{calibri}<w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="000000"/>'
        '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>'
        '<w:spacing w:after="120" w:line="300" w:lineRule="auto"/>'
        '</w:pPr></w:pPrDefault></w:docDefaults>'
        + style(
            "Normal",
            "Normal",
            "",
            '<w:spacing w:after="120" w:line="300" w:lineRule="auto"/>',
            f'{calibri}<w:sz w:val="22"/><w:szCs w:val="22"/>',
        )
        + style(
            "Title",
            "Title",
            "Normal",
            '<w:spacing w:before="0" w:after="160"/><w:jc w:val="center"/>',
            f'{calibri}<w:b/><w:sz w:val="52"/><w:szCs w:val="52"/><w:color w:val="0B2545"/>',
        )
        + style(
            "Subtitle",
            "Subtitle",
            "Normal",
            '<w:spacing w:after="320"/><w:jc w:val="center"/>',
            f'{calibri}<w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="555555"/>',
        )
        + style(
            "Heading1",
            "heading 1",
            "Normal",
            '<w:keepNext/><w:spacing w:before="360" w:after="200" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="0"/>',
            f'{calibri}<w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="2E74B5"/>',
        )
        + style(
            "Heading2",
            "heading 2",
            "Normal",
            '<w:keepNext/><w:spacing w:before="280" w:after="140" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="1"/>',
            f'{calibri}<w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="2E74B5"/>',
        )
        + style(
            "Heading3",
            "heading 3",
            "Normal",
            '<w:keepNext/><w:spacing w:before="200" w:after="100" w:line="300" w:lineRule="auto"/><w:outlineLvl w:val="2"/>',
            f'{calibri}<w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="1F4D78"/>',
        )
        + style(
            "ListParagraph",
            "List Paragraph",
            "Normal",
            '<w:spacing w:after="80" w:line="300" w:lineRule="auto"/>',
            f'{calibri}<w:sz w:val="22"/><w:szCs w:val="22"/>',
        )
        + style(
            "CodeBlock",
            "Code Block",
            "Normal",
            '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="auto"/><w:ind w:left="240"/>'
            '<w:shd w:fill="F4F6F9"/>',
            f'{courier}<w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="111111"/>',
        )
        + style(
            "Caption",
            "Caption",
            "Normal",
            '<w:spacing w:before="0" w:after="160"/><w:jc w:val="center"/>',
            f'{calibri}<w:i/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="555555"/>',
        )
        + style(
            "TableBody",
            "Table Body",
            "Normal",
            '<w:spacing w:after="40" w:line="280" w:lineRule="auto"/>',
            f'{calibri}<w:sz w:val="20"/><w:szCs w:val="20"/>',
        )
        + style(
            "TableHeader",
            "Table Header",
            "Normal",
            '<w:spacing w:after="20" w:line="280" w:lineRule="auto"/>',
            f'{calibri}<w:b/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="0B2545"/>',
        )
	        + style(
	            "TableLabel",
	            "Table Label",
	            "Normal",
	            '<w:spacing w:after="20" w:line="280" w:lineRule="auto"/>',
	            f'{calibri}<w:b/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="1F4D78"/>',
	        )
	        + '<w:style w:type="table" w:styleId="LessonTable"><w:name w:val="Lesson Table"/>'
        '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="DADCE0"/>'
        '<w:left w:val="single" w:sz="4" w:color="DADCE0"/><w:bottom w:val="single" w:sz="4" w:color="DADCE0"/>'
        '<w:right w:val="single" w:sz="4" w:color="DADCE0"/><w:insideH w:val="single" w:sz="4" w:color="DADCE0"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="DADCE0"/></w:tblBorders></w:tblPr></w:style>'
        '<w:style w:type="table" w:styleId="CalloutTable"><w:name w:val="Callout Table"/>'
        '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="6" w:color="C8D4E3"/>'
        '<w:left w:val="single" w:sz="6" w:color="C8D4E3"/><w:bottom w:val="single" w:sz="6" w:color="C8D4E3"/>'
        '<w:right w:val="single" w:sz="6" w:color="C8D4E3"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>'
        '</w:tblBorders><w:shd w:fill="F4F6F9"/></w:tblPr></w:style>'
        "</w:styles>"
    )


def numbering_xml():
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:numbering xmlns:w="{W_NS}">'
        '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>'
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>'
        '<w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs>'
        '<w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum>'
        '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>'
        '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/>'
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>'
        '<w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs>'
        '<w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum>'
        '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>'
        "</w:numbering>"
    )


def header_xml():
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:hdr xmlns:w="{W_NS}" xmlns:r="{R_NS}">'
        '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:spacing w:after="0"/></w:pPr>'
        '<w:r><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr>'
        '<w:t>Sonic Math Runner - bài giảng lập trình từ cơ bản tới nâng cao</w:t></w:r></w:p>'
        "</w:hdr>"
    )


def footer_xml():
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:ftr xmlns:w="{W_NS}" xmlns:r="{R_NS}">'
        '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>'
        '<w:r><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr>'
        '<w:t>Tài liệu học tập nội bộ - đọc code thật, làm từng phần nhỏ</w:t></w:r></w:p>'
        "</w:ftr>"
    )


def static_parts(doc):
    write(
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        "</Types>",
    )
    write(
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>",
    )
    write(
        "word/_rels/document.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
        + "".join(doc.rels)
        + "</Relationships>",
    )
    write(
        "word/settings.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:settings xmlns:w="{W_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/></w:settings>',
    )
    write(
        "docProps/core.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        '<dc:title>Bài giảng Sonic Math Runner cho học sinh cấp 2</dc:title>'
        '<dc:creator>Codex</dc:creator>'
        '<cp:keywords>JavaScript, Three.js, Express, SQLite, game giáo dục</cp:keywords>'
        '<dc:description>Bài giảng từ cơ bản tới nâng cao dựa trên repo Game-Sonic-Running.</dc:description>'
        "</cp:coreProperties>",
    )
    write(
        "docProps/app.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        '<Application>Codex OOXML Builder</Application></Properties>',
    )
    write("word/styles.xml", styles_xml())
    write("word/numbering.xml", numbering_xml())
    write("word/header1.xml", header_xml())
    write("word/footer1.xml", footer_xml())


def add_lesson_content(doc):
    doc.add_paragraph("Bài giảng Sonic Math Runner", style="Title")
    doc.add_paragraph(
        "Từ chưa biết code tới hiểu và tự làm lại dự án game chạy 3D có câu hỏi Toán, admin, API và database",
        style="Subtitle",
    )
    doc.add_table(
        [
            ["Dành cho", "Học sinh cấp 2 bắt đầu từ con số 0"],
            ["Dự án đọc", "Game-Sonic-Running"],
            ["Công nghệ chính", "HTML, CSS, JavaScript, Three.js, Node.js, Express, SQLite"],
            ["Cách học", "Mỗi buổi có khái niệm, ví dụ nhỏ, rồi gắn lại vào dự án thật"],
        ],
        widths=[2200, CONTENT_WIDTH_DXA - 2200],
        shade_first_col=True,
    )
    doc.add_callout(
        "Lời hứa của bài học",
        "Không bắt đầu bằng thuật ngữ khó. Ta sẽ đi từ chuyện quen thuộc: trang web giống quyển sách tương tác, dữ liệu giống bảng ghi chép, hàm giống công thức làm việc, server giống quầy phát dữ liệu cho game.",
    )
    doc.add_image(".claude/game-running.png", "Màn hình game đang chạy: nhân vật chạy trên đường 3D, có điểm và tim.", 5.8)

    doc.add_heading("1. Nhìn Toàn Cảnh Dự Án", 1)
    doc.add_paragraph(
        "Sonic Math Runner là game web 3D kiểu endless runner. Người chơi chọn lớp 6, 7 hoặc 8, điều khiển nhân vật né vật cản, chạm vòng để mở câu hỏi Toán. Trả lời đúng được cộng điểm; trả lời sai, hết giờ hoặc bỏ lỡ vòng thì mất tim."
    )
    doc.add_table(
        [
            ["Mảnh ghép", "Nhiệm vụ", "File chính"],
            ["Cửa vào game", "Mở trang, tải game shell", "index.html, EndlessRunner.htm"],
            ["Game 3D", "Dựng cảnh, nhân vật, vật cản, va chạm, điểm, tim", "EndlessRunner.htm, EndlessRunner.js"],
            ["Ngân hàng câu hỏi", "Lấy câu hỏi từ server, cache, lưu câu đã hiện trên máy người chơi", "questionBank.js, shared/questionModel.js"],
            ["Admin", "Đăng nhập, thêm/sửa/xóa câu hỏi, chỉnh điểm/thời gian/tốc độ", "admin.html"],
            ["Backend", "API, bảo mật admin, lưu SQLite", "server/app.js, server/db.js, server/auth.js"],
            ["Dữ liệu", "Câu hỏi seed cho lớp 6, 7, 8", "questions/lop6.json, lop7.json, lop8.json"],
            ["Triển khai", "Vercel hoặc server riêng PM2/Nginx", "vercel.json, start.sh, restart.sh"],
        ],
        widths=[1800, 4300, 3260],
    )
    doc.add_paragraph("Luồng chơi chính:")
    for item in [
        "Trình duyệt mở index.html.",
        "index.html tải EndlessRunner.htm.",
        "Game nạp Three.js, model, âm thanh, shared/questionModel.js và questionBank.js.",
        "Người chơi chọn lớp, frontend gọi GET /api/levels/:level/question-bank.",
        "Game bắt đầu chạy; chạm ring thì tạm dừng và hiện quiz.",
        "Kết quả câu hỏi được ghi vào localStorage của trình duyệt.",
    ]:
        doc.add_number(item)
    doc.add_image(".claude/admin-login.png", "Màn hình admin: nơi quản lý câu hỏi và cấu hình game sau khi đăng nhập.", 5.4)

    doc.add_heading("2. Những Viên Gạch Đầu Tiên", 1)
    doc.add_paragraph(
        "Trước khi viết game, học sinh cần hiểu 6 ý rất nhỏ. Mỗi ý giống một viên gạch; ghép đủ thì mới xây được ngôi nhà."
    )
    doc.add_table(
        [
            ["Khái niệm", "Hiểu đơn giản", "Ví dụ trong dự án"],
            ["File", "Một tờ giấy chứa nội dung hoặc lệnh", "admin.html là một trang quản trị"],
            ["HTML", "Bộ xương của trang web", "Nút chọn lớp, hộp câu hỏi, bảng admin"],
            ["CSS", "Quần áo và cách sắp xếp", "Màu nền, panel, nút, lưới đáp án"],
            ["JavaScript", "Bộ não điều khiển hành động", "Bấm A/B/C/D, đổi điểm, gọi API"],
            ["JSON", "Cách ghi dữ liệu có cấu trúc", "Mỗi câu hỏi có id, question, answers, correctAnswer"],
            ["Server", "Máy phục vụ dữ liệu cho trình duyệt", "Express trả question bank và nhận chỉnh sửa admin"],
        ],
        widths=[1600, 3900, 3860],
    )
    doc.add_heading("2.1. Biến, hàm, mảng, object", 2)
    doc.add_paragraph("Trong dự án, JavaScript dùng 4 thứ căn bản nhất:")
    doc.add_bullet("Biến: chiếc hộp đặt tên, ví dụ score = 0 hoặc lives = 3.")
    doc.add_bullet("Hàm: một việc được đóng gói, ví dụ updateScoreDisplay() cập nhật điểm trên màn hình.")
    doc.add_bullet("Mảng: danh sách nhiều món, ví dụ questions là danh sách câu hỏi.")
    doc.add_bullet("Object: một món có nhiều thuộc tính, ví dụ một câu hỏi có id, difficulty, answers.")
    doc.add_code(
        """var score = 0;
var lives = 3;

function updateScoreDisplay() {
    document.getElementById("endlessrunner-score-value").textContent = score;
}"""
    )
    doc.add_callout(
        "Cách giảng cho học sinh",
        "Đừng bắt học thuộc định nghĩa. Hãy cho học sinh sửa score = 100, đổi lives = 5, rồi chạy lại để thấy code làm thay đổi màn hình.",
    )

    doc.add_heading("3. Dữ Liệu Câu Hỏi", 1)
    doc.add_paragraph(
        "Dự án có 1.200 câu hỏi seed: lớp 6 có 100 câu, lớp 7 có 100 câu, lớp 8 có 1.000 câu. Mỗi lớp chia theo easy, medium, hard, expert."
    )
    doc.add_table(
        [
            ["Lớp", "Số câu", "Phân bố", "Thời gian", "Điểm"],
            ["Lớp 6", "100", "40 easy, 30 medium, 20 hard, 10 expert", "12-20 giây", "10-25"],
            ["Lớp 7", "100", "40 easy, 30 medium, 20 hard, 10 expert", "12-20 giây", "10-25"],
            ["Lớp 8", "1000", "400 easy, 300 medium, 200 hard, 100 expert", "24-40 giây", "10-25"],
        ],
        widths=[1200, 1200, 4100, 1450, 1410],
    )
    doc.add_paragraph("Một câu hỏi mẫu:")
    doc.add_code(
        """{
  "id": "6q001",
  "difficulty": "easy",
  "question": "9 x 7 = ?",
  "answers": { "A": "63", "B": "56" },
  "correctAnswer": "A",
  "point": 10,
  "time": 12
}"""
    )
    doc.add_paragraph("Luật kiểm tra dữ liệu trong shared/questionModel.js:")
    for item in [
        "id không được rỗng và không được trùng trong cùng một lớp.",
        "question không được rỗng.",
        "answers phải có ít nhất A và B.",
        "Nếu có C hoặc D thì phải theo đúng thứ tự A, B, C, D, không được bỏ C mà có D.",
        "correctAnswer phải là đáp án thật đang tồn tại.",
        "point phải >= 0; time phải là số nguyên >= 1.",
    ]:
        doc.add_bullet(item)
    doc.add_callout(
        "Bài tập nhỏ",
        "Tạo một câu hỏi mới trong questions/lop6.json trên giấy trước. Sau đó kiểm tra: có id chưa, có ít nhất 2 đáp án chưa, đáp án đúng có nằm trong A/B/C/D không.",
    )

    doc.add_heading("4. Frontend Game: Từ Màn Hình Tới Gameplay", 1)
    doc.add_paragraph(
        "Frontend là phần người chơi nhìn thấy và chạm vào. Dự án không dùng React hay framework lớn; game shell được viết bằng HTML/CSS/JavaScript thuần, còn phần 3D dùng Three.js."
    )
    doc.add_heading("4.1. index.html chỉ là cổng vào", 2)
    doc.add_paragraph(
        "index.html không chứa toàn bộ game. Nó hiện chữ Loading game..., fetch EndlessRunner.htm rồi ghi nội dung đó vào document. Cách này giúp đường dẫn gốc luôn mở đúng game."
    )
    doc.add_code(
        """fetch("EndlessRunner.htm?v=20260415", { cache: "no-store" })
  .then(function(response) { return response.text(); })
  .then(function(html) {
    document.open();
    document.write(html);
    document.close();
  });"""
    )
    doc.add_heading("4.2. Three.js dựng thế giới 3D", 2)
    doc.add_table(
        [
            ["Thành phần Three.js", "Nghĩa đơn giản", "Trong game"],
            ["Scene", "Sân khấu", "Chứa đường chạy, nhân vật, mây, ring, enemy"],
            ["Camera", "Con mắt nhìn sân khấu", "Nhìn từ sau Sonic về phía đường chạy"],
            ["Renderer", "Máy vẽ", "Vẽ scene lên canvas WebGL"],
            ["Mesh", "Một vật thể có hình và màu", "Đường, cỏ, ring, enemy"],
            ["Texture", "Ảnh dán lên vật thể", "Đá đường, cỏ, nước"],
            ["AnimationMixer", "Bộ phát chuyển động", "Cho Sonic chạy"],
        ],
        widths=[2100, 3200, 4060],
    )
    doc.add_paragraph("Những biến quan trọng trong game:")
    doc.add_code(
        """var score = 0;
var lives = 3;
var questions = [];
var selectedLevel = null;
var questionQueue = [];
var isQuestionActive = false;"""
    )
    doc.add_heading("4.3. Game loop", 2)
    doc.add_paragraph(
        "Game loop là vòng lặp chạy liên tục: cập nhật nhân vật, kéo vật cản lại gần, kiểm tra va chạm, rồi vẽ lại. Trong dự án, hàm render() gọi requestAnimationFrame(render)."
    )
    doc.add_bullet("Nếu game_running là true, mọi thứ tiếp tục chuyển động.")
    doc.add_bullet("Nếu đang hiện quiz, pauseDueToQuiz làm game tạm dừng.")
    doc.add_bullet("Tốc độ game lấy từ database, rồi nhân lên khi tính bước di chuyển và khoảng sinh vật cản.")
    doc.add_heading("4.4. Va chạm và câu hỏi", 2)
    doc.add_paragraph(
        "Dự án dùng hộp va chạm Box3. Hãy tưởng tượng mỗi vật được đặt trong một hộp vô hình. Nếu hộp của Sonic chạm hộp của ring, game mở câu hỏi."
    )
    doc.add_code(
        """var heroMeshBox = new THREE.Box3().setFromObject(hero);
var obstacleMeshBox = new THREE.Box3().setFromObject(obstacle);

if (heroMeshBox.intersectsBox(obstacleMeshBox)) {
    openQuestionFromRing(obstacle);
}"""
    )
    doc.add_paragraph("Khi chạm ring:")
    for item in [
        "Lấy câu tiếp theo từ questionQueue.",
        "Gọi QuestionBank.markQuestionShown để ghi nhận câu đã hiện.",
        "Tạm dừng game bằng pauseDueToQuiz.",
        "Hiện overlay câu hỏi và đồng hồ đếm ngược.",
        "Đúng thì cộng điểm; sai hoặc hết giờ thì mất tim.",
    ]:
        doc.add_number(item)

    doc.add_heading("5. QuestionBank: Cầu Nối Giữa Game Và Server", 1)
    doc.add_paragraph(
        "questionBank.js là lớp trung gian. Game không tự đọc file JSON trực tiếp nữa; nó gọi QuestionBank để lấy dữ liệu từ API, cache dữ liệu, lưu lịch sử câu đã hiện/trả lời vào localStorage."
    )
    doc.add_table(
        [
            ["Hàm", "Dùng để làm gì"],
            ["getLevelBundle(level)", "Tải questions, pointSettings, timeSettings, gameSpeed từ server"],
            ["filterAvailableQuestions(level, questions)", "Loại bỏ câu đã hiện/trả lời trên trình duyệt hiện tại"],
            ["markQuestionShown(level, question)", "Ghi câu vừa được hiển thị"],
            ["markQuestionResult(level, id, status)", "Ghi kết quả correct/wrong/timeout"],
            ["saveQuestions(level, questions)", "Admin gửi danh sách câu hỏi mới lên server"],
            ["savePointSettings/saveTimeSettings/saveGameSpeed", "Admin cập nhật cấu hình"],
        ],
        widths=[3200, 6160],
    )
    doc.add_callout(
        "Phân biệt quan trọng",
        "Câu hỏi lưu trong SQLite trên server. Nhưng lịch sử câu đã hiện/trả lời lưu trong localStorage của từng trình duyệt, nên không tự đồng bộ giữa các máy.",
    )

    doc.add_heading("6. Trang Admin", 1)
    doc.add_paragraph(
        "admin.html là một ứng dụng quản trị viết trong một file. Nó có phần đăng nhập, chọn lớp, bảng thống kê, form câu hỏi, bảng danh sách câu hỏi và các nút lưu điểm/thời gian/tốc độ."
    )
    doc.add_image(".claude/game-level.png", "Màn hình trước khi bắt đầu chơi: người dùng cần chọn hoặc bấm play tùy trạng thái game.", 5.2)
    doc.add_heading("6.1. appState là sổ tay của admin page", 2)
    doc.add_code(
        """var appState = {
  level: "lop6",
  questions: [],
  answeredEntries: [],
  editingQuestionId: null,
  editingQuestionIndex: -1,
  isInitialized: false
};"""
    )
    doc.add_paragraph("Các thao tác chính:")
    doc.add_bullet("renderLevelButtons() tạo nút lớp 6/7/8.")
    doc.add_bullet("renderQuestionTable() vẽ bảng câu hỏi.")
    doc.add_bullet("buildQuestionFromForm() đọc form và validate câu hỏi.")
    doc.add_bullet("handleQuestionSubmit() thêm hoặc cập nhật câu hỏi rồi gọi QuestionBank.saveQuestions().")
    doc.add_bullet("handleSaveTimes(), handleSavePoints(), handleSaveSpeed() cập nhật cấu hình cho cả 3 lớp.")
    doc.add_heading("6.2. Vì sao phải escapeHTML?", 2)
    doc.add_paragraph(
        "Admin page có hàm escapeHTML để khi hiển thị dữ liệu người dùng nhập, trình duyệt không hiểu nhầm đó là HTML nguy hiểm. Đây là thói quen bảo mật cơ bản."
    )

    doc.add_heading("7. Backend Express Và SQLite", 1)
    doc.add_paragraph(
        "Backend là phần chạy bằng Node.js. Nó nhận request từ trình duyệt, kiểm tra quyền admin, đọc/ghi SQLite và trả JSON."
    )
    doc.add_table(
        [
            ["File", "Vai trò"],
            ["server/index.js", "Nạp .env, tạo app, listen port, đóng DB khi tắt"],
            ["server/app.js", "Định nghĩa route API, static file, middleware lỗi"],
            ["server/config.js", "Đọc PORT, JWT_SECRET, ADMIN_PASSWORD_HASH, DATABASE_PATH"],
            ["server/auth.js", "bcrypt, JWT, cookie HttpOnly, middleware requireAdminAuth"],
            ["server/db.js", "Tạo bảng, seed JSON, đọc/ghi câu hỏi và settings"],
            ["api/index.js", "Adapter để Vercel chạy Express app như serverless function"],
        ],
        widths=[2400, 6960],
    )
    doc.add_heading("7.1. API của dự án", 2)
    doc.add_table(
        [
            ["Method", "Đường dẫn", "Ai dùng", "Mục đích"],
            ["GET", "/api/health", "Public", "Kiểm tra server và database sẵn sàng"],
            ["GET", "/api/levels/:level/question-bank", "Game/Admin", "Lấy câu hỏi và cấu hình lớp"],
            ["POST", "/api/admin/login", "Admin", "Đăng nhập bằng mật khẩu"],
            ["POST", "/api/admin/logout", "Admin", "Đăng xuất"],
            ["GET", "/api/admin/session", "Admin", "Kiểm tra còn đăng nhập không"],
            ["PUT", "/api/levels/:level/questions", "Admin", "Thay toàn bộ câu hỏi của một lớp"],
            ["PUT", "/api/levels/:level/settings/point", "Admin", "Cập nhật điểm theo độ khó cho cả 3 lớp"],
            ["PUT", "/api/levels/:level/settings/time", "Admin", "Cập nhật thời gian theo độ khó cho cả 3 lớp"],
            ["PUT", "/api/levels/:level/settings/speed", "Admin", "Cập nhật tốc độ game cho cả 3 lớp"],
        ],
        widths=[900, 3000, 1300, 4160],
    )
    doc.add_heading("7.2. SQLite có 3 bảng", 2)
    doc.add_table(
        [
            ["Bảng", "Lưu gì", "Điểm cần nhớ"],
            ["questions", "Câu hỏi theo level, id, đáp án, điểm, thời gian", "Khóa chính là (level, id)"],
            ["difficulty_settings", "Điểm và thời gian mặc định theo độ khó", "Áp dụng cho easy/medium/hard/expert"],
            ["level_settings", "Tốc độ game", "game_speed mặc định là 1.0, hợp lệ từ 0.5 tới 2.0"],
        ],
        widths=[2200, 4200, 2960],
    )
    doc.add_paragraph("Seed dữ liệu:")
    for item in [
        "Server tạo file SQLite trong .runtime, hoặc /tmp khi chạy Vercel.",
        "Nếu bảng questions rỗng, server đọc questions/lop6.json, lop7.json, lop8.json.",
        "Dữ liệu được validate bằng shared/questionModel.js.",
        "Nếu DB đã có dữ liệu, JSON seed không tự ghi đè.",
    ]:
        doc.add_number(item)

    doc.add_heading("8. Bảo Mật Admin", 1)
    doc.add_paragraph(
        "Dự án không lưu mật khẩu admin dạng chữ thường. Ta tạo hash bằng bcrypt, lưu hash trong .env, rồi khi admin đăng nhập, server dùng bcrypt.compare để kiểm tra."
    )
    doc.add_code(
        """npm run hash-password -- mat-khau-admin

JWT_SECRET=chuoi-bi-mat-dai
ADMIN_PASSWORD_HASH=ket-qua-bcrypt"""
    )
    doc.add_paragraph("Sau khi đúng mật khẩu:")
    doc.add_bullet("Server tạo JWT có role admin.")
    doc.add_bullet("JWT được đặt vào cookie tên admin_token.")
    doc.add_bullet("Cookie là HttpOnly, JavaScript phía client không đọc trực tiếp được.")
    doc.add_bullet("Các API sửa dữ liệu dùng requireAdminAuth để chặn người chưa đăng nhập.")

    doc.add_heading("9. PWA, Cache Và Chạy Offline", 1)
    doc.add_paragraph(
        "Dự án có manifest EndlessRunner.json và service worker worker.js. Đây là phần giúp game giống một ứng dụng web có thể cache tài nguyên."
    )
    doc.add_table(
        [
            ["Phần", "Ý nghĩa"],
            ["EndlessRunner.json", "Tên app, icon, start_url, màu nền, chế độ standalone"],
            ["worker.js install", "Cache các file chính như index.html, admin.html, EndlessRunner.htm, JS, icon"],
            ["worker.js fetch", "Ưu tiên lấy bản mới từ mạng, nếu lỗi thì dùng cache cho asset chính"],
            ["API question-bank", "Có cache riêng để khi mạng lỗi vẫn có dữ liệu gần nhất"],
        ],
        widths=[2200, 7160],
    )

    doc.add_heading("10. Kiểm Thử", 1)
    doc.add_paragraph(
        "Dự án dùng node:test và supertest. Kiểm thử không phải việc của riêng người lớn; học sinh có thể hiểu test như một danh sách câu hỏi kiểm tra xem chương trình có làm đúng lời hứa không."
    )
    doc.add_table(
        [
            ["Test", "Kiểm điều gì"],
            ["validateConfig rejects placeholder secrets", "Không cho chạy với secret mẫu"],
            ["resolveConfig uses Vercel writable temp directory", "Vercel dùng /tmp cho SQLite"],
            ["health endpoint and seeded question bank", "API health và seed lớp 6 hoạt động"],
            ["admin login, session cookie and logout", "Đăng nhập, session, đăng xuất đúng"],
            ["question bank writes persist", "Sửa câu hỏi lưu được sau restart và chặn id trùng"],
            ["difficulty settings update", "Point/time/speed cần auth và áp dụng cho cả 3 lớp"],
        ],
        widths=[3600, 5760],
    )
    doc.add_code("npm test")
    doc.add_paragraph("Lần kiểm tra khi tạo tài liệu này: 6 test pass.")

    doc.add_heading("11. Lộ Trình Dạy 12 Buổi", 1)
    doc.add_table(
        [
            ["Buổi", "Mục tiêu", "Sản phẩm nhỏ"],
            ["1", "Làm quen file, trình duyệt, HTML", "Trang có tiêu đề và nút Play"],
            ["2", "CSS căn bản", "Màn hình chọn lớp đẹp và rõ"],
            ["3", "JavaScript: biến, hàm, sự kiện", "Bấm nút đổi điểm trên màn hình"],
            ["4", "Array/object/JSON", "Tạo danh sách câu hỏi và hiển thị câu đầu tiên"],
            ["5", "Quiz overlay", "Bấm A/B để kiểm tra đúng sai"],
            ["6", "Canvas/Three.js căn bản", "Scene có camera, đường chạy, một khối chuyển động"],
            ["7", "Game loop và điều khiển lane", "Nhân vật đổi trái/phải"],
            ["8", "Va chạm và tim", "Chạm vật cản thì mất tim"],
            ["9", "Fetch API", "Game lấy câu hỏi từ server"],
            ["10", "Express và route", "Tạo GET /api/health và GET question-bank"],
            ["11", "SQLite và admin", "Lưu câu hỏi, thêm/sửa/xóa bằng form"],
            ["12", "Test, PWA, deploy", "Chạy npm test, hiểu cache, biết cách đưa lên mạng"],
        ],
        widths=[900, 3900, 4560],
    )
    doc.add_heading("11.1. Nguyên tắc dạy học sinh chưa biết code", 2)
    for item in [
        "Mỗi buổi chỉ thêm một khái niệm mới thật sự.",
        "Cho học sinh sửa con số, màu, chữ trước khi viết logic dài.",
        "Luôn chạy được sau mỗi bước nhỏ.",
        "Dùng console.log như đèn pin để xem chương trình đang nghĩ gì.",
        "Khi lỗi, đọc lỗi từ trên xuống: file nào, dòng nào, thông báo gì.",
        "Không bắt học sinh nhớ hết cú pháp; cho các em dùng mẫu và hiểu ý nghĩa.",
    ]:
        doc.add_bullet(item)

    doc.add_heading("12. Hướng Dẫn Làm Lại Dự Án Theo Từng Mốc", 1)
    doc.add_heading("Mốc 1: làm quiz web không có game", 2)
    doc.add_number("Tạo index.html có tiêu đề, câu hỏi, hai nút A/B.")
    doc.add_number("Tạo biến score và hàm updateScoreDisplay().")
    doc.add_number("Khi bấm đúng, cộng điểm; bấm sai, hiện thông báo.")
    doc.add_number("Đưa câu hỏi vào mảng questions thay vì viết cứng một câu.")
    doc.add_heading("Mốc 2: thêm dữ liệu JSON", 2)
    doc.add_number("Tạo questions/lop6.json.")
    doc.add_number("Mỗi câu có id, question, answers, correctAnswer, point, time.")
    doc.add_number("Viết hàm validateQuestion đơn giản.")
    doc.add_number("Hiển thị từng câu và tránh lặp lại câu đã trả lời.")
    doc.add_heading("Mốc 3: thêm game 3D đơn giản", 2)
    doc.add_number("Tạo Three.js scene, camera, renderer.")
    doc.add_number("Dựng đường chạy bằng BoxGeometry.")
    doc.add_number("Tạo nhân vật tạm bằng hình hộp trước khi có model Sonic.")
    doc.add_number("Tạo ring và enemy, cho chúng tiến về người chơi.")
    doc.add_number("Dùng Box3 để kiểm tra va chạm.")
    doc.add_heading("Mốc 4: nối quiz vào ring", 2)
    doc.add_number("Nếu chạm enemy thì mất tim.")
    doc.add_number("Nếu chạm ring thì pause game và hiện quiz.")
    doc.add_number("Đúng thì cộng point; sai/hết giờ thì mất tim.")
    doc.add_number("Ẩn quiz và cho game chạy tiếp.")
    doc.add_heading("Mốc 5: thêm backend", 2)
    doc.add_number("Tạo package.json, cài express.")
    doc.add_number("Viết GET /api/health.")
    doc.add_number("Viết GET /api/levels/:level/question-bank.")
    doc.add_number("Frontend dùng fetch thay vì dùng dữ liệu cứng.")
    doc.add_heading("Mốc 6: thêm database và admin", 2)
    doc.add_number("Cài better-sqlite3.")
    doc.add_number("Tạo bảng questions, difficulty_settings, level_settings.")
    doc.add_number("Seed dữ liệu từ JSON khi DB rỗng.")
    doc.add_number("Tạo admin.html có form thêm/sửa/xóa.")
    doc.add_number("Thêm bcrypt, JWT, cookie HttpOnly để bảo vệ API sửa dữ liệu.")

    doc.add_heading("13. Các Lỗi Hay Gặp Và Cách Gỡ", 1)
    doc.add_table(
        [
            ["Lỗi", "Nguyên nhân thường gặp", "Cách xử lý"],
            ["Game không tải", "Server chưa chạy hoặc EndlessRunner.htm lỗi", "Mở DevTools Console và Network, kiểm tra npm start"],
            ["API báo Missing JWT_SECRET", ".env vẫn dùng giá trị mẫu", "Tạo JWT_SECRET thật hoặc chạy start.sh"],
            ["Admin đăng nhập sai", "Mật khẩu không khớp hash bcrypt", "Chạy npm run hash-password -- <password> và cập nhật .env"],
            ["Câu hỏi không lưu", "Chưa đăng nhập admin hoặc dữ liệu không hợp lệ", "Kiểm tra cookie, xem lỗi validate id/answers/correctAnswer"],
            ["DB không đổi khi sửa JSON", "SQLite đã có dữ liệu nên không seed lại", "Xóa DB runtime khi muốn seed lại trong môi trường dev"],
            ["Service worker dùng file cũ", "Cache trình duyệt chưa cập nhật", "Đổi cache name trong worker.js hoặc unregister service worker khi dev"],
            ["Model 3D không hiện", "Asset/bundle lỗi hoặc WebGL lỗi", "Kiểm tra Console, thử trình duyệt hỗ trợ WebGL"],
        ],
        widths=[1900, 3500, 3960],
    )

    doc.add_heading("14. Phần Nâng Cao", 1)
    doc.add_heading("14.1. Vì sao gameSpeed được bình phương?", 2)
    doc.add_paragraph(
        "Trong EndlessRunner.htm, getEffectiveGameSpeedMultiplier() trả về gameSpeedMultiplier * gameSpeedMultiplier. Nghĩa là nếu admin đặt 1.5, tốc độ hiệu dụng là 2.25. Đây là lựa chọn thiết kế để thay đổi tốc độ rõ rệt hơn."
    )
    doc.add_heading("14.2. Vì sao point/time áp dụng cho cả 3 lớp?", 2)
    doc.add_paragraph(
        "server/db.js có hàm updateDifficultySettingsForAllLevels. Khi admin lưu điểm hoặc thời gian theo độ khó, backend lặp qua QuestionModel.LEVELS và cập nhật cả lop6, lop7, lop8. Đây là hành vi hiện tại của source."
    )
    doc.add_heading("14.3. Vercel và SQLite", 2)
    doc.add_paragraph(
        "vercel.json cho phép deploy qua api/index.js. Nhưng filesystem Vercel là read-only, nên config chuyển SQLite runtime sang /tmp. Điều này giúp app chạy được, nhưng dữ liệu admin không bền qua cold start hoặc redeploy. Nếu muốn sản phẩm thật, nên dùng database ngoài."
    )
    doc.add_heading("14.4. Server riêng", 2)
    doc.add_paragraph(
        "start.sh và restart.sh dành cho server Ubuntu/Debian. Chúng cài Node.js, PM2, Nginx, tạo PM2 ecosystem, cấu hình reverse proxy, HTTPS bằng Let's Encrypt hoặc Cloudflare Origin Certificate, rồi health check /api/health."
    )

    doc.add_heading("15. Bảng Thuật Ngữ", 1)
    doc.add_table(
        [
            ["Từ", "Nghĩa dễ hiểu"],
            ["Frontend", "Phần người dùng nhìn thấy trong trình duyệt"],
            ["Backend", "Phần server xử lý dữ liệu và bảo mật"],
            ["API", "Cửa giao tiếp giữa frontend và backend"],
            ["Route", "Một đường dẫn API cụ thể"],
            ["Middleware", "Người gác cổng chạy trước route"],
            ["Database", "Nơi lưu dữ liệu có tổ chức"],
            ["SQLite", "Database nhỏ gọn nằm trong một file"],
            ["JWT", "Thẻ đăng nhập có chữ ký server"],
            ["Cookie HttpOnly", "Cookie trình duyệt giữ nhưng JavaScript client không đọc trực tiếp được"],
            ["localStorage", "Kho lưu nhỏ trên trình duyệt của từng máy"],
            ["PWA", "Web app có manifest, icon, cache, cảm giác gần giống app"],
            ["Game loop", "Vòng lặp cập nhật và vẽ game liên tục"],
            ["Collision", "Va chạm giữa hai vật trong game"],
            ["Seed", "Nạp dữ liệu ban đầu vào database"],
        ],
        widths=[2500, 6860],
    )
    doc.add_callout(
        "Kết luận cho giáo viên",
        "Dự án này phù hợp để dạy theo kiểu xoắn ốc: lần đầu chỉ làm quiz đơn giản, lần hai thêm game loop, lần ba thêm server, lần bốn thêm database và admin. Không nên bắt học sinh hiểu toàn bộ Three.js bundle ngay từ đầu; hãy coi EndlessRunner.js là thư viện/asset lớn, tập trung vào các điểm tích hợp thật trong EndlessRunner.htm, questionBank.js và server.",
    )


def package_docx():
    with zipfile.ZipFile(OUT_DOCX, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(BUILD_DIR.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(BUILD_DIR).as_posix())


def main():
    ensure_dirs()
    doc = DocBuilder()
    add_lesson_content(doc)
    write("word/document.xml", doc.document_xml())
    static_parts(doc)
    OUT_DOCX.parent.mkdir(parents=True, exist_ok=True)
    package_docx()
    print(OUT_DOCX)


if __name__ == "__main__":
    main()
