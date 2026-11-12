import os
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_margins(cell, top=60, bottom=60, left=80, right=80):
    """Set inner padding for a table cell (in twips: 20 twips = 1 pt)."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def set_cell_shading(cell, color_hex):
    """Set cell background color."""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{color_hex}"/>')
    tcPr.append(shd)

def set_table_borders(table, color="CCCCCC", sz="4", val="single"):
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'  <w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:left w:val="none"/>'
        f'  <w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:right w:val="none"/>'
        f'  <w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'  <w:insideV w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def remove_table_borders(table):
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'  <w:top w:val="none"/>'
        f'  <w:left w:val="none"/>'
        f'  <w:bottom w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'  <w:insideH w:val="none"/>'
        f'  <w:insideV w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def add_header(doc, isu_logo_path, mark_logo_path):
    header_table = doc.add_table(rows=1, cols=3)
    header_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    remove_table_borders(header_table)
    
    widths = [Inches(1.0), Inches(5.1), Inches(1.0)]
    for row in header_table.rows:
        for idx, width in enumerate(widths):
            row.cells[idx].width = width

    # Left - ISU Logo
    c0 = header_table.cell(0, 0)
    set_cell_margins(c0, top=0, bottom=0, left=0, right=0)
    p0 = c0.paragraphs[0]
    p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p0.paragraph_format.space_before = Pt(0)
    p0.paragraph_format.space_after = Pt(0)
    if os.path.exists(isu_logo_path):
        p0.add_run().add_picture(isu_logo_path, width=Inches(0.85))

    # Center - Text
    c1 = header_table.cell(0, 1)
    set_cell_margins(c1, top=0, bottom=0, left=40, right=40)
    p1 = c1.paragraphs[0]
    p1.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p1.paragraph_format.space_before = Pt(0)
    p1.paragraph_format.space_after = Pt(0)
    p1.paragraph_format.line_spacing = 1.05
    
    r1 = p1.add_run("Republic of the Philippines\n")
    r1.font.name = "Arial"
    r1.font.size = Pt(8)
    r1.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
    
    r2 = p1.add_run("ISABELA STATE UNIVERSITY\n")
    r2.font.name = "Arial"
    r2.font.size = Pt(11.5)
    r2.font.bold = True
    r2.font.color.rgb = RGBColor(0x0B, 0x66, 0x23)
    
    r3 = p1.add_run("Echague, Isabela — Main Campus\n")
    r3.font.name = "Arial"
    r3.font.size = Pt(8)
    r3.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    r4 = p1.add_run("COLLEGE OF COMPUTING STUDIES, INFORMATION AND COMMUNICATION TECHNOLOGY\n")
    r4.font.name = "Arial"
    r4.font.size = Pt(8.5)
    r4.font.bold = True
    r4.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    r5 = p1.add_run("Department of Computer Science • Data Mining Track")
    r5.font.name = "Arial"
    r5.font.size = Pt(7.5)
    r5.font.italic = True
    r5.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    # Right - IskAI Mark
    c2 = header_table.cell(0, 2)
    set_cell_margins(c2, top=0, bottom=0, left=0, right=0)
    p2 = c2.paragraphs[0]
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p2.paragraph_format.space_before = Pt(0)
    p2.paragraph_format.space_after = Pt(0)
    if os.path.exists(mark_logo_path):
        p2.add_run().add_picture(mark_logo_path, width=Inches(0.85))

    # Divider bar
    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_before = Pt(3)
    p_div.paragraph_format.space_after = Pt(6)
    p_div_border = parse_xml(
        f'<w:pBdr {nsdecls("w")}>'
        f'  <w:bottom w:val="double" w:sz="12" w:space="1" w:color="0B6623"/>'
        f'</w:pBdr>'
    )
    p_div._p.get_or_add_pPr().append(p_div_border)

def build_implementation_doc():
    doc = docx.Document()
    
    # 0.65-inch margins around the page to ensure crisp layout
    for section in doc.sections:
        section.page_width = Inches(8.5)
        section.page_height = Inches(11.0)
        section.top_margin = Inches(0.55)
        section.bottom_margin = Inches(0.55)
        section.left_margin = Inches(0.7)
        section.right_margin = Inches(0.7)

    isu_logo = os.path.abspath("rag-thesis-frontend/public/isu-logo.jpg")
    mark_logo = os.path.abspath("rag-thesis-frontend/public/isu-thesis-ai-mark.png")

    # ==========================================
    # PAGE 1: FORMAL IMPLEMENTATION LETTER
    # ==========================================
    add_header(doc, isu_logo, mark_logo)

    # Document Title
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_title.paragraph_format.space_before = Pt(0)
    p_title.paragraph_format.space_after = Pt(4)
    r_title = p_title.add_run("LETTER OF SYSTEM IMPLEMENTATION AND TURNOVER")
    r_title.font.name = "Arial"
    r_title.font.size = Pt(11)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    # Metadata Memorandum Block
    memo_table = doc.add_table(rows=4, cols=2)
    memo_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    remove_table_borders(memo_table)
    memo_widths = [Inches(1.0), Inches(6.1)]

    headers_meta = [
        ("DATE:", "November 12, 2026"),
        ("TO:", "DR. FLORENDA B. TEMANEL — Executive Officer / Campus Administrator, ISU Echague Main Campus"),
        ("THRU:", "DR. ALBERT VINLUAN — Thesis Adviser / Research & Linkages Coordinator, CCSICT"),
        ("SUBJECT:", "Formal System Implementation, Deployment, and Acceptance of \"IskAI: A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation\"")
    ]

    for idx, (label, val) in enumerate(headers_meta):
        row = memo_table.rows[idx]
        row.cells[0].width = memo_widths[0]
        row.cells[1].width = memo_widths[1]
        set_cell_margins(row.cells[0], top=20, bottom=20, left=40, right=40)
        set_cell_margins(row.cells[1], top=20, bottom=20, left=40, right=40)

        bg_col = "F8FAFC" if idx % 2 == 0 else "FFFFFF"
        set_cell_shading(row.cells[0], bg_col)
        set_cell_shading(row.cells[1], bg_col)

        p_lbl = row.cells[0].paragraphs[0]
        p_lbl.paragraph_format.space_before = Pt(0)
        p_lbl.paragraph_format.space_after = Pt(0)
        r_lbl = p_lbl.add_run(label)
        r_lbl.font.name = "Arial"
        r_lbl.font.size = Pt(8.5)
        r_lbl.font.bold = True
        r_lbl.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

        p_val = row.cells[1].paragraphs[0]
        p_val.paragraph_format.space_before = Pt(0)
        p_val.paragraph_format.space_after = Pt(0)
        r_val = p_val.add_run(val)
        r_val.font.name = "Arial"
        r_val.font.size = Pt(8.5)
        if idx == 3:
            r_val.font.bold = True
            r_val.font.color.rgb = RGBColor(0x0B, 0x66, 0x23)
        else:
            r_val.font.color.rgb = RGBColor(0x22, 0x22, 0x22)

    # Salutation
    p_sal = doc.add_paragraph()
    p_sal.paragraph_format.space_before = Pt(4)
    p_sal.paragraph_format.space_after = Pt(3)
    r_sal = p_sal.add_run("Dear Dr. Temanel:")
    r_sal.font.name = "Arial"
    r_sal.font.size = Pt(8.5)
    r_sal.font.bold = True
    r_sal.font.color.rgb = RGBColor(0x22, 0x22, 0x22)

    # Body Paragraph 1
    p_b1 = doc.add_paragraph()
    p_b1.paragraph_format.space_before = Pt(0)
    p_b1.paragraph_format.space_after = Pt(3)
    p_b1.paragraph_format.line_spacing = 1.1
    p_b1.paragraph_format.first_line_indent = Inches(0.25)
    
    r_b1_1 = p_b1.add_run("We are honored to respectfully endorse the complete deployment, technical turnover, and institutional implementation of the research software system titled ")
    r_b1_1.font.name = "Arial"
    r_b1_1.font.size = Pt(8.5)
    r_b1_1.font.color.rgb = RGBColor(0x22, 0x22, 0x22)

    r_b1_2 = p_b1.add_run("“A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation” (IskAI)")
    r_b1_2.font.name = "Arial"
    r_b1_2.font.size = Pt(8.5)
    r_b1_2.font.bold = True
    r_b1_2.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    r_b1_3 = p_b1.add_run(", developed in partial fulfillment of the degree requirements for ")
    r_b1_3.font.name = "Arial"
    r_b1_3.font.size = Pt(8.5)
    r_b1_3.font.color.rgb = RGBColor(0x22, 0x22, 0x22)

    r_b1_4 = p_b1.add_run("Bachelor of Science in Computer Science (BSCS — Data Mining Track)")
    r_b1_4.font.name = "Arial"
    r_b1_4.font.size = Pt(8.5)
    r_b1_4.font.bold = True

    r_b1_5 = p_b1.add_run(" at the College of Computing Studies, Information and Communication Technology (CCSICT), Isabela State University – Echague Main Campus.")
    r_b1_5.font.name = "Arial"
    r_b1_5.font.size = Pt(8.5)

    # Body Paragraph 2
    p_b2 = doc.add_paragraph()
    p_b2.paragraph_format.space_before = Pt(0)
    p_b2.paragraph_format.space_after = Pt(3)
    p_b2.paragraph_format.line_spacing = 1.1
    p_b2.paragraph_format.first_line_indent = Inches(0.25)
    r_b2 = p_b2.add_run(
        "IskAI is deployed as an indirect, closed-domain academic thesis repository that eliminates the risks of ungrounded LLM hallucinations and protects raw manuscript intellectual property. Utilizing high-dimensional vector embeddings, hybrid semantic reranking, and LangChain orchestration with Google Gemini, the platform delivers verifiable, citation-backed answers strictly grounded in CCSICT's institutional research corpus."
    )
    r_b2.font.name = "Arial"
    r_b2.font.size = Pt(8.5)

    # Body Paragraph 3: Bullets
    p_b3_head = doc.add_paragraph()
    p_b3_head.paragraph_format.space_before = Pt(0)
    p_b3_head.paragraph_format.space_after = Pt(2)
    p_b3_head.paragraph_format.line_spacing = 1.1
    r_b3h = p_b3_head.add_run("The deployed production environment comprises five operational subsystems:")
    r_b3h.font.name = "Arial"
    r_b3h.font.size = Pt(8.5)
    r_b3h.font.bold = True
    r_b3h.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    bullets = [
        ("Closed-Domain RAG Pipeline: ", "LangChain + Supabase pgvector + Gemini 3.8 Flash with 800/100-token chunking and hybrid reranking for citation-stamped research assistance."),
        ("Proposal Novelty & Duplication Guard: ", "Screens Working Title, Rationale, Objectives, and Methodology against an 85% cosine similarity threshold to prevent duplicate research."),
        ("Academic Front-Matter Extraction: ", "Automatically parses Title, Authors, Year, Adviser, Panel, and Dual Abstracts (verbatim & AI-extended) upon ingestion."),
        ("Student Research Workspace: ", "Delivers interactive starter chips, multi-thesis comparative synthesis trays, and one-click APA 7th Edition / BibTeX citation copy."),
        ("Administrative Governance Console: ", "Enforces 5-year recency filtering, permanent archival retention, role-based security, and full operational audit logs.")
    ]

    for bt, bd in bullets:
        pb = doc.add_paragraph(style='List Bullet')
        pb.paragraph_format.space_before = Pt(0)
        pb.paragraph_format.space_after = Pt(1)
        pb.paragraph_format.line_spacing = 1.05
        
        rbt = pb.add_run(bt)
        rbt.font.name = "Arial"
        rbt.font.size = Pt(8)
        rbt.font.bold = True
        rbt.font.color.rgb = RGBColor(0x0B, 0x66, 0x23)

        rbd = pb.add_run(bd)
        rbd.font.name = "Arial"
        rbd.font.size = Pt(8)
        rbd.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

    # Body Paragraph 4: Turnover statement
    p_b4 = doc.add_paragraph()
    p_b4.paragraph_format.space_before = Pt(2)
    p_b4.paragraph_format.space_after = Pt(4)
    p_b4.paragraph_format.line_spacing = 1.1
    p_b4.paragraph_format.first_line_indent = Inches(0.25)
    r_b4 = p_b4.add_run(
        "All software deliverables, containerized production codebases, deployment configurations, database schemas, user manuals, and administrative credentials have been fully turned over. Comprehensive automated and user acceptance testing confirms that the system complies with ISO/IEC 25010 software quality standards."
    )
    r_b4.font.name = "Arial"
    r_b4.font.size = Pt(8.5)

    # Proponents Signatures Table
    p_prop_h = doc.add_paragraph()
    p_prop_h.paragraph_format.space_before = Pt(2)
    p_prop_h.paragraph_format.space_after = Pt(2)
    r_proph = p_prop_h.add_run("Respectfully submitted by the Proponents:")
    r_proph.font.name = "Arial"
    r_proph.font.size = Pt(8.5)
    r_proph.font.bold = True
    r_proph.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    prop_tbl = doc.add_table(rows=1, cols=2)
    prop_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    remove_table_borders(prop_tbl)
    prop_tbl.rows[0].cells[0].width = Inches(3.5)
    prop_tbl.rows[0].cells[1].width = Inches(3.6)

    # Barlis
    cb = prop_tbl.rows[0].cells[0]
    set_cell_margins(cb, top=10, bottom=10, left=20, right=20)
    pb = cb.paragraphs[0]
    pb.paragraph_format.space_after = Pt(0)
    pb.paragraph_format.line_spacing = 1.05
    pb.add_run("_____________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    rbn = pb.add_run("AHRON JOHN F. BARLIS\n")
    rbn.font.name = "Arial"
    rbn.font.size = Pt(8.5)
    rbn.font.bold = True
    rbr = pb.add_run("Lead Developer / BSCS Proponent\nDate Signed: ________________________")
    rbr.font.name = "Arial"
    rbr.font.size = Pt(7.5)
    rbr.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # Gallardo
    cg = prop_tbl.rows[0].cells[1]
    set_cell_margins(cg, top=10, bottom=10, left=20, right=20)
    pg = cg.paragraphs[0]
    pg.paragraph_format.space_after = Pt(0)
    pg.paragraph_format.line_spacing = 1.05
    pg.add_run("_____________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    rgn = pg.add_run("CARLO ROSSI P. GALLARDO\n")
    rgn.font.name = "Arial"
    rgn.font.size = Pt(8.5)
    rgn.font.bold = True
    rgr = pg.add_run("Co-Developer / BSCS Proponent\nDate Signed: ________________________")
    rgr.font.name = "Arial"
    rgr.font.size = Pt(7.5)
    rgr.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # Institutional Signatories
    p_inst_h = doc.add_paragraph()
    p_inst_h.paragraph_format.space_before = Pt(6)
    p_inst_h.paragraph_format.space_after = Pt(2)
    r_insth = p_inst_h.add_run("VERIFIED, ENDORSED, AND APPROVED BY:")
    r_insth.font.name = "Arial"
    r_insth.font.size = Pt(8.5)
    r_insth.font.bold = True
    r_insth.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    sig_row1 = doc.add_table(rows=1, cols=2)
    sig_row1.alignment = WD_TABLE_ALIGNMENT.CENTER
    remove_table_borders(sig_row1)
    sig_row1.rows[0].cells[0].width = Inches(3.5)
    sig_row1.rows[0].cells[1].width = Inches(3.6)

    # Jen Bermusa
    cj = sig_row1.rows[0].cells[0]
    set_cell_margins(cj, top=10, bottom=10, left=20, right=20)
    pj = cj.paragraphs[0]
    pj.paragraph_format.space_after = Pt(0)
    pj.paragraph_format.line_spacing = 1.05
    rj_t = pj.add_run("Verified and Implemented by:\n\n")
    rj_t.font.name = "Arial"
    rj_t.font.size = Pt(8)
    rj_t.font.italic = True
    pj.add_run("_____________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    rjn = pj.add_run("JEN BERMUSA\n")
    rjn.font.name = "Arial"
    rjn.font.size = Pt(9)
    rjn.font.bold = True
    rjd = pj.add_run("Technical Implementation Lead / IT Faculty\nCollege of Computing Studies, Information & Comm. Tech.\nDate Signed: ________________________")
    rjd.font.name = "Arial"
    rjd.font.size = Pt(7.5)
    rjd.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # Dr. Albert Vinluan
    ca = sig_row1.rows[0].cells[1]
    set_cell_margins(ca, top=10, bottom=10, left=20, right=20)
    pa = ca.paragraphs[0]
    pa.paragraph_format.space_after = Pt(0)
    pa.paragraph_format.line_spacing = 1.05
    ra_t = pa.add_run("Recommending Approval / Thesis Adviser:\n\n")
    ra_t.font.name = "Arial"
    ra_t.font.size = Pt(8)
    ra_t.font.italic = True
    pa.add_run("_____________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    ran = pa.add_run("DR. ALBERT VINLUAN\n")
    ran.font.name = "Arial"
    ran.font.size = Pt(9)
    ran.font.bold = True
    rad = pa.add_run("Thesis Adviser / Program Chair, BS Data Science\nCollege Research & Linkages Coordinator, CCSICT\nDate Signed: ________________________")
    rad.font.name = "Arial"
    rad.font.size = Pt(7.5)
    rad.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # Row 2: Dr. Florenda B. Temanel
    sig_row2 = doc.add_table(rows=1, cols=1)
    sig_row2.alignment = WD_TABLE_ALIGNMENT.CENTER
    remove_table_borders(sig_row2)
    sig_row2.rows[0].cells[0].width = Inches(5.0)

    ct = sig_row2.rows[0].cells[0]
    set_cell_margins(ct, top=10, bottom=10, left=20, right=20)
    pt = ct.paragraphs[0]
    pt.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pt.paragraph_format.space_after = Pt(0)
    pt.paragraph_format.line_spacing = 1.08
    rt_l = pt.add_run("APPROVED AND ACCEPTED BY:\n\n")
    rt_l.font.name = "Arial"
    rt_l.font.size = Pt(8)
    rt_l.font.bold = True
    rt_l.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)
    pt.add_run("_____________________________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    rtn = pt.add_run("DR. FLORENDA B. TEMANEL\n")
    rtn.font.name = "Arial"
    rtn.font.size = Pt(9.5)
    rtn.font.bold = True
    rtn.font.color.rgb = RGBColor(0x0B, 0x66, 0x23)
    rtd = pt.add_run("Executive Officer / Campus Administrator\nIsabela State University — Echague Main Campus\nDate Signed: ________________________")
    rtd.font.name = "Arial"
    rtd.font.size = Pt(8)
    rtd.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # ==========================================
    # PAGE 2: OFFICIAL CERTIFICATE OF IMPLEMENTATION & ACCEPTANCE
    # ==========================================
    doc.add_page_break()
    add_header(doc, isu_logo, mark_logo)

    # Certificate Title
    p_ct = doc.add_paragraph()
    p_ct.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_ct.paragraph_format.space_before = Pt(0)
    p_ct.paragraph_format.space_after = Pt(2)
    r_ct = p_ct.add_run("CERTIFICATE OF SYSTEM IMPLEMENTATION AND ACCEPTANCE")
    r_ct.font.name = "Arial"
    r_ct.font.size = Pt(11.5)
    r_ct.font.bold = True
    r_ct.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    p_cs = doc.add_paragraph()
    p_cs.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_cs.paragraph_format.space_before = Pt(0)
    p_cs.paragraph_format.space_after = Pt(6)
    r_cs = p_cs.add_run("Institutional Deployment and Technical Turnover Sign-Off")
    r_cs.font.name = "Arial"
    r_cs.font.size = Pt(8.5)
    r_cs.font.italic = True
    r_cs.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

    # Preamble Box
    box_tbl = doc.add_table(rows=1, cols=1)
    box_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(box_tbl, color="0B6623", sz="8")
    set_cell_margins(box_tbl.rows[0].cells[0], top=80, bottom=80, left=120, right=120)
    set_cell_shading(box_tbl.rows[0].cells[0], "F4F9F5")
    box_tbl.rows[0].cells[0].width = Inches(7.1)

    p_box = box_tbl.rows[0].cells[0].paragraphs[0]
    p_box.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p_box.paragraph_format.line_spacing = 1.12
    p_box.paragraph_format.space_after = Pt(0)
    
    r_box_1 = p_box.add_run("THIS IS TO CERTIFY that ")
    r_box_1.font.name = "Arial"
    r_box_1.font.size = Pt(8.5)
    r_box_1.font.bold = True

    r_box_2 = p_box.add_run(
        "the software system titled “A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation” (IskAI), "
        "developed and submitted by AHRON JOHN F. BARLIS and CARLO ROSSI P. GALLARDO in partial fulfillment of the degree of "
        "Bachelor of Science in Computer Science (Data Mining Track), has been fully delivered, deployed, tested, and officially "
        "IMPLEMENTED and ACCEPTED for institutional operations at the College of Computing Studies, Information and Communication Technology (CCSICT)."
    )
    r_box_2.font.name = "Arial"
    r_box_2.font.size = Pt(8.5)
    r_box_2.font.color.rgb = RGBColor(0x22, 0x22, 0x22)

    # Matrix Header
    p_mh = doc.add_paragraph()
    p_mh.paragraph_format.space_before = Pt(6)
    p_mh.paragraph_format.space_after = Pt(3)
    r_mh = p_mh.add_run("SYSTEM IMPLEMENTATION & OPERATIONAL ACCEPTANCE MATRIX:")
    r_mh.font.name = "Arial"
    r_mh.font.size = Pt(8.5)
    r_mh.font.bold = True
    r_mh.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    # Matrix Table
    mat_tbl = doc.add_table(rows=7, cols=4)
    mat_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(mat_tbl, color="CBD5E1", sz="4")
    col_w = [Inches(0.35), Inches(2.2), Inches(3.45), Inches(1.1)]

    for row in mat_tbl.rows:
        for idx, w in enumerate(col_w):
            row.cells[idx].width = w

    headers_m = ["#", "Subsystem / Deliverable", "Scope of Operational Implementation", "Status"]
    h_row = mat_tbl.rows[0]
    for idx, ht in enumerate(headers_m):
        c = h_row.cells[idx]
        set_cell_margins(c, top=50, bottom=50, left=60, right=60)
        set_cell_shading(c, "1B365D")
        p = c.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        if idx in [0, 3]:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(ht)
        r.font.name = "Arial"
        r.font.size = Pt(8)
        r.font.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    m_data = [
        ("1", "Closed-Domain RAG Retrieval Engine", "LangChain + Supabase pgvector + Gemini 3.8 Flash; 800/100-token overlap chunking, deterministic reranking, citation-backed answers.", "OPERATIONAL\n& ACCEPTED"),
        ("2", "4-Section Research Capsule Scanner", "Analyzes Title, Rationale, Objectives, Methodology; automated cosine similarity screening with 85% safety threshold.", "OPERATIONAL\n& ACCEPTED"),
        ("3", "Front-Matter Ingestion & Dual Abstract", "Automated extraction of Title, Authors, Advisers, Panelists; dual abstract mode (verbatim and AI-synthesized).", "OPERATIONAL\n& ACCEPTED"),
        ("4", "Student Workspace & Citation Tools", "Interactive query starter chips, 3-thesis comparative synthesis tray, APA 7th Edition and BibTeX bibliographic generation.", "OPERATIONAL\n& ACCEPTED"),
        ("5", "Administrative Governance Portal", "Role-based access control, 5-year recency filter toggle, inventory health checks, audit logs, and secure archive maintenance.", "OPERATIONAL\n& ACCEPTED"),
        ("6", "Source Code & Deployment Artifacts", "Complete Git repository, Docker containers, database migrations, technical deployment documentation, and admin credentials.", "DELIVERED\n& VERIFIED")
    ]

    for r_idx, (num, mod, scope, stat) in enumerate(m_data, start=1):
        row = mat_tbl.rows[r_idx]
        bg = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"
        for c_idx in range(4):
            set_cell_margins(row.cells[c_idx], top=40, bottom=40, left=50, right=50)
            set_cell_shading(row.cells[c_idx], bg)

        # Col 0: #
        p0 = row.cells[0].paragraphs[0]
        p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p0.paragraph_format.space_before = Pt(0)
        p0.paragraph_format.space_after = Pt(0)
        r0 = p0.add_run(num)
        r0.font.name = "Arial"
        r0.font.size = Pt(7.5)
        r0.font.bold = True

        # Col 1: Mod
        p1 = row.cells[1].paragraphs[0]
        p1.paragraph_format.space_before = Pt(0)
        p1.paragraph_format.space_after = Pt(0)
        r1 = p1.add_run(mod)
        r1.font.name = "Arial"
        r1.font.size = Pt(7.5)
        r1.font.bold = True
        r1.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

        # Col 2: Scope
        p2 = row.cells[2].paragraphs[0]
        p2.paragraph_format.space_before = Pt(0)
        p2.paragraph_format.space_after = Pt(0)
        p2.paragraph_format.line_spacing = 1.05
        r2 = p2.add_run(scope)
        r2.font.name = "Arial"
        r2.font.size = Pt(7.5)
        r2.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

        # Col 3: Status
        p3 = row.cells[3].paragraphs[0]
        p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p3.paragraph_format.space_before = Pt(0)
        p3.paragraph_format.space_after = Pt(0)
        r3 = p3.add_run(stat)
        r3.font.name = "Arial"
        r3.font.size = Pt(7)
        r3.font.bold = True
        r3.font.color.rgb = RGBColor(0x0B, 0x66, 0x23)

    # Certification issuance note
    p_note = doc.add_paragraph()
    p_note.paragraph_format.space_before = Pt(6)
    p_note.paragraph_format.space_after = Pt(6)
    p_note.paragraph_format.line_spacing = 1.1
    r_nt = p_note.add_run(
        "Issued this 12th day of November, 2026 at Isabela State University – Main Campus, Echague, Isabela, Philippines. "
        "This certification confirms that the system satisfies all operational, technical, and institutional requirements."
    )
    r_nt.font.name = "Arial"
    r_nt.font.size = Pt(8)
    r_nt.font.italic = True
    r_nt.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # Signatures for Certificate (Jen Bermusa, Dr. Albert Vinluan, Dr. Florenda B. Temanel)
    p_csig_h = doc.add_paragraph()
    p_csig_h.paragraph_format.space_before = Pt(2)
    p_csig_h.paragraph_format.space_after = Pt(2)
    r_csigh = p_csig_h.add_run("OFFICIAL SYSTEM ACCEPTANCE AND SIGN-OFF:")
    r_csigh.font.name = "Arial"
    r_csigh.font.size = Pt(8.5)
    r_csigh.font.bold = True
    r_csigh.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

    c_sig_row1 = doc.add_table(rows=1, cols=2)
    c_sig_row1.alignment = WD_TABLE_ALIGNMENT.CENTER
    remove_table_borders(c_sig_row1)
    c_sig_row1.rows[0].cells[0].width = Inches(3.5)
    c_sig_row1.rows[0].cells[1].width = Inches(3.6)

    # Jen Bermusa
    c_j = c_sig_row1.rows[0].cells[0]
    set_cell_margins(c_j, top=10, bottom=10, left=20, right=20)
    pj2 = c_j.paragraphs[0]
    pj2.paragraph_format.space_after = Pt(0)
    pj2.paragraph_format.line_spacing = 1.05
    pj2.add_run("Verified and Implemented by:\n\n").font.italic = True
    pj2.runs[0].font.size = Pt(8)
    pj2.add_run("_____________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    r_jn2 = pj2.add_run("JEN BERMUSA\n")
    r_jn2.font.name = "Arial"
    r_jn2.font.size = Pt(9)
    r_jn2.font.bold = True
    r_jd2 = pj2.add_run("Technical Implementation Lead / IT Faculty\nCollege of Computing Studies, Information & Comm. Tech.\nDate Signed: ________________________")
    r_jd2.font.name = "Arial"
    r_jd2.font.size = Pt(7.5)
    r_jd2.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # Dr. Albert Vinluan
    c_a = c_sig_row1.rows[0].cells[1]
    set_cell_margins(c_a, top=10, bottom=10, left=20, right=20)
    pa2 = c_a.paragraphs[0]
    pa2.paragraph_format.space_after = Pt(0)
    pa2.paragraph_format.line_spacing = 1.05
    pa2.add_run("Recommending Approval / Thesis Adviser:\n\n").font.italic = True
    pa2.runs[0].font.size = Pt(8)
    pa2.add_run("_____________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    r_an2 = pa2.add_run("DR. ALBERT VINLUAN\n")
    r_an2.font.name = "Arial"
    r_an2.font.size = Pt(9)
    r_an2.font.bold = True
    r_ad2 = pa2.add_run("Thesis Adviser / Program Chair, BS Data Science\nCollege Research & Linkages Coordinator, CCSICT\nDate Signed: ________________________")
    r_ad2.font.name = "Arial"
    r_ad2.font.size = Pt(7.5)
    r_ad2.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    # Approved By: Dr. Florenda B. Temanel
    c_sig_row2 = doc.add_table(rows=1, cols=1)
    c_sig_row2.alignment = WD_TABLE_ALIGNMENT.CENTER
    remove_table_borders(c_sig_row2)
    c_sig_row2.rows[0].cells[0].width = Inches(5.0)

    c_t = c_sig_row2.rows[0].cells[0]
    set_cell_margins(c_t, top=10, bottom=10, left=20, right=20)
    pt2 = c_t.paragraphs[0]
    pt2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pt2.paragraph_format.space_after = Pt(0)
    pt2.paragraph_format.line_spacing = 1.08
    r_tl2 = pt2.add_run("APPROVED AND ACCEPTED BY:\n\n")
    r_tl2.font.name = "Arial"
    r_tl2.font.size = Pt(8)
    r_tl2.font.bold = True
    r_tl2.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)
    pt2.add_run("_____________________________________________________\n").font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    r_tn2 = pt2.add_run("DR. FLORENDA B. TEMANEL\n")
    r_tn2.font.name = "Arial"
    r_tn2.font.size = Pt(9.5)
    r_tn2.font.bold = True
    r_tn2.font.color.rgb = RGBColor(0x0B, 0x66, 0x23)
    r_td2 = pt2.add_run("Executive Officer / Campus Administrator\nIsabela State University — Echague Main Campus\nDate Signed: ________________________")
    r_td2.font.name = "Arial"
    r_td2.font.size = Pt(8)
    r_td2.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    output_path = "System_Implementation_Letter.docx"
    doc.save(output_path)
    print(f"Successfully generated: {output_path}")

if __name__ == "__main__":
    build_implementation_doc()
