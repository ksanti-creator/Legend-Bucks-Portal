"""Create a readable Word document from the maintained gift-card guide."""
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED


class GuideParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.blocks = []
        self.text = []
        self.style = "Normal"
        self.in_row = False

    def flush(self):
        text = " ".join("".join(self.text).split())
        if text:
            self.blocks.append((self.style, text))
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self.active = True
        if not self.active:
            return
        if tag in ("h1", "h2", "h3", "p", "li", "div", "tr", "footer"):
            self.flush()
            self.style = {"h1": "Title", "h2": "Heading1", "h3": "Heading2"}.get(tag, "Normal")
            if tag == "li":
                self.text.append("• ")
            if tag == "tr":
                self.in_row = True
        if tag == "br":
            self.text.append(" — ")
        if tag in ("td", "th") and self.text:
            self.text.append(" — ")

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3", "p", "li", "div", "tr", "footer"):
            self.flush()
        if tag == "main":
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.text.append(data)


base = Path(__file__).resolve().parent
parser = GuideParser()
parser.feed((base / "gift-card-user-guide.html").read_text())
paragraphs = []
for style, text in parser.blocks:
    if text.startswith("Based on the current implementation."):
        text = "Based on the current implementation. Screen availability depends on permissions and rollout status."
    paragraphs.append(f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')
ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
document = f'<?xml version="1.0" encoding="UTF-8"?><w:document {ns}><w:body>{"".join(paragraphs)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>'
styles = f'''<?xml version="1.0" encoding="UTF-8"?><w:styles {ns}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="195941"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="195941"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style>
</w:styles>'''
with ZipFile(base / "Legend-Bucks-Gift-Card-Guide.docx", "w", ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
    z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    z.writestr("word/_rels/document.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    z.writestr("word/document.xml", document)
    z.writestr("word/styles.xml", styles)
print(f"Created Word guide: {len(paragraphs)} paragraphs.")