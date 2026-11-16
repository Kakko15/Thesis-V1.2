"""Build IskAI_User_Manual.docx (task-oriented end-user manual).

Every UI label is quoted from rag-thesis-frontend/src (see research reports).
Screenshots are read from docs/manual/screenshots/<name>.png; a missing file
becomes a labelled placeholder box so the document always builds.
"""
import re
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(r"C:\Users\Kazuha\Desktop\Thesis-V1")
SHOTS = ROOT / "docs" / "manual" / "screenshots"
OUT = ROOT / "IskAI_User_Manual.docx"
FONT = "Times New Roman"
GREEN = RGBColor(0x05, 0x60, 0x3A)
GOLD = "F5E6B8"
MISSING = []
FIG = [0]
TAB = [0]

doc = Document()

# ---------------------------------------------------------------- styles
def _style(name, size, bold=False, color=None, before=0, after=6):
    st = doc.styles[name]
    st.font.name = FONT
    rf = st.element.rPr.rFonts
    for a in ("ascii", "hAnsi", "eastAsia", "cs"):
        rf.set(qn(f"w:{a}"), FONT)
    for a in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
        if rf.get(qn(f"w:{a}")) is not None:
            del rf.attrib[qn(f"w:{a}")]
    st.font.size = Pt(size)
    st.font.bold = bold
    if color is not None:
        st.font.color.rgb = color
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    return st

_style("Normal", 12, after=6).paragraph_format.line_spacing = 1.15
_style("Heading 1", 18, True, GREEN, 0, 12)
_style("Heading 2", 14, True, GREEN, 14, 6)
_style("Heading 3", 12, True, RGBColor(0x22, 0x22, 0x22), 10, 4)
_style("List Bullet", 12, after=3)
_style("Caption", 10, False, RGBColor(0x44, 0x44, 0x44), 2, 10)
doc.styles["Caption"].font.italic = True
for h in ("Heading 1", "Heading 2", "Heading 3"):
    doc.styles[h].paragraph_format.keep_with_next = True

sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
    setattr(sec, side, Inches(1))

# ---------------------------------------------------------------- helpers
TOKEN = re.compile(r"(\*\*.+?\*\*|`.+?`|_.+?_)")


def runs(p, text, size=None):
    for part in TOKEN.split(text):
        if not part:
            continue
        if part.startswith("**"):
            r = p.add_run(part[2:-2]); r.bold = True
        elif part.startswith("`"):
            r = p.add_run(part[1:-1]); r.font.name = "Consolas"; r.font.size = Pt(10.5)
        elif part.startswith("_") and part.endswith("_") and len(part) > 2:
            r = p.add_run(part[1:-1]); r.italic = True
        else:
            r = p.add_run(part)
        if size and not part.startswith("`"):
            r.font.size = Pt(size)
    return p


def para(text, align=None, size=None, after=None):
    p = runs(doc.add_paragraph(), text, size)
    if align is not None:
        p.alignment = align
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    return p


def h1(t, new_page=True, front=False):
    if new_page:
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    if front:  # front matter: looks like Heading 1 but stays out of the TOC
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(12)
        r = p.add_run(t); r.bold = True; r.font.size = Pt(18); r.font.color.rgb = GREEN
        return
    doc.add_heading(t, 1)


def h2(t):
    doc.add_heading(t, 2)


def h3(t):
    doc.add_heading(t, 3)


def bullets(items):
    for it in items:
        runs(doc.add_paragraph(style="List Bullet"), it)


def steps(items):
    """Numbered steps; a tuple (step, result) adds an indented result line."""
    for i, it in enumerate(items, 1):
        text, result = (it if isinstance(it, tuple) else (it, None))
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent, pf.first_line_indent, pf.space_after = Inches(0.4), Inches(-0.3), Pt(3)
        r = p.add_run(f"{i}.\t"); r.bold = True
        pf.tab_stops.add_tab_stop(Inches(0.4))
        runs(p, text)
        if result:
            q = doc.add_paragraph()
            q.paragraph_format.left_indent = Inches(0.4)
            q.paragraph_format.space_after = Pt(4)
            rr = q.add_run("Result: "); rr.italic = True; rr.bold = True
            runs(q, result)


def shade(cell, hex_fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hex_fill)
    tcPr.append(shd)


def callout(kind, text):
    fills = {"NOTE": "E8F1FB", "TIP": "E6F4EA", "WARNING": "FDECEA", "IMPORTANT": GOLD}
    t = doc.add_table(rows=1, cols=1)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    c = t.rows[0].cells[0]
    shade(c, fills[kind])
    p = c.paragraphs[0]
    r = p.add_run(f"{kind.title()}: "); r.bold = True
    runs(p, text, 11)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def table(headers, rows, widths=None, caption=None):
    if caption:
        TAB[0] += 1
        cp = doc.add_paragraph(style="Caption")
        cp.add_run(f"Table {TAB[0]}. {caption}").italic = False
        cp.paragraph_format.keep_with_next = True
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]
        shade(c, "05603A")
        r = c.paragraphs[0].add_run(h); r.bold = True; r.font.size = Pt(11)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    hdr = OxmlElement("w:tblHeader"); hdr.set(qn("w:val"), "true")
    t.rows[0]._tr.get_or_add_trPr().append(hdr)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            runs(cells[i].paragraphs[0], str(v), 11)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def figure(name, caption, width=6.0):
    FIG[0] += 1
    path = SHOTS / f"{name}.png"
    if path.exists():
        p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.keep_with_next = True
        p.add_run().add_picture(str(path), width=Inches(width))
    else:
        MISSING.append(name)
        t = doc.add_table(rows=1, cols=1); t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        c = t.rows[0].cells[0]; shade(c, "F2F2F2")
        p = c.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(f"\n[Screenshot pending: {name}.png]\n"); r.italic = True
        r.font.color.rgb = RGBColor(0x80, 0x80, 0x80)
    cp = doc.add_paragraph(style="Caption"); cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cp.add_run(f"Figure {FIG[0]}. {caption}")


def field(paragraph, instr):
    r = paragraph.add_run()
    b = OxmlElement("w:fldChar"); b.set(qn("w:fldCharType"), "begin")
    i = OxmlElement("w:instrText"); i.set(qn("xml:space"), "preserve"); i.text = instr
    s = OxmlElement("w:fldChar"); s.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t"); t.text = "Right-click and choose Update Field."
    e = OxmlElement("w:fldChar"); e.set(qn("w:fldCharType"), "end")
    for el in (b, i, s, t, e):
        r._r.append(el)


def task(title, purpose, before, step_list, result=None, after=None):
    """Standard task block: heading, purpose, prerequisites, steps, result."""
    h3(title)
    para(purpose)
    if before:
        p = para(f"**Before you begin:** {before}")
    steps(step_list)
    if result:
        para(f"**Result:** {result}")
    if after:
        after()


# ================================================================ TITLE PAGE
for _ in range(5):
    doc.add_paragraph()
para("**ISABELA STATE UNIVERSITY**", WD_ALIGN_PARAGRAPH.CENTER, 14, 0)
para("College of Computing Studies, Information and Communication Technology", WD_ALIGN_PARAGRAPH.CENTER, 12, 0)
para("Echague, Isabela", WD_ALIGN_PARAGRAPH.CENTER, 12, 36)
t = para("**IskAI**", WD_ALIGN_PARAGRAPH.CENTER, 36, 0)
t.runs[0].font.color.rgb = GREEN
para("**ISU Thesis AI Library**", WD_ALIGN_PARAGRAPH.CENTER, 20, 4)
para("User Manual", WD_ALIGN_PARAGRAPH.CENTER, 18, 48)
para("For Guest Researchers, Students, Faculty Advisers, and Administrators", WD_ALIGN_PARAGRAPH.CENTER, 12, 4)
para(f"Version 1.0 · {date.today():%B %Y}", WD_ALIGN_PARAGRAPH.CENTER, 12, 4)

# ================================================================ ABOUT THIS MANUAL
h1("About This Manual", front=True)
para("This manual explains how to use **IskAI**, the ISU Thesis AI Library of the College of Computing "
     "Studies, Information and Communication Technology (CCSICT). It is written for the people who use "
     "the system every day: guest researchers, students, faculty advisers, and administrators.")
para("The manual is **task-oriented**. Each section answers one \"How do I…?\" question with numbered "
     "steps and tells you what you should see when the task is done. You do not need to read it from "
     "start to finish; go to the chapter for your role and the task you need.")
h3("Who Should Read Which Chapter")
table(["If you are…", "Read"], [
    ["A visitor without an account", "Chapters 1, 2, 3.1, and 7"],
    ["A student", "Chapters 1–3, 6, and 7"],
    ["A faculty adviser", "Chapters 1–4, 6, and 7"],
    ["An administrator or superadmin", "All chapters, especially Chapter 5"],
], [2.6, 3.4])
h3("Conventions Used")
table(["Convention", "Meaning", "Example"], [
    ["**Bold text**", "A label exactly as it appears on screen: a button, menu item, tab, or field", "Click **Sign in →**."],
    ["`Monospace`", "A web address, file name, or key you type", "`localhost:5173/chat`"],
    ["Key + Key", "Press the keys together", "Ctrl + K"],
    ["→", "Go through a series of menus", "**Settings** → **Security**"],
    ["Result:", "What you should see after a step or task", ""],
], [1.4, 3.0, 1.6])
callout("NOTE", "Background information that helps you understand a feature.")
callout("TIP", "A shortcut or a better way to do something.")
callout("WARNING", "An action that cannot be undone, or that may lock you out. Read it before you continue.")

# ================================================================ TOC
h1("Table of Contents", front=True)
field(doc.add_paragraph(), 'TOC \\o "1-2" \\h \\z \\u')

# ================================================================ CH 1
h1("1. Introduction")
h2("1.1 What IskAI Is")
para("IskAI is the centralized, AI-assisted research library of CCSICT. You ask a question in plain "
     "language, and IskAI answers using **only** the theses and faculty research stored in the CCSICT "
     "archive. Every answer lists the studies it came from, so you can trace each statement to its source.")
para("IskAI helps you to:")
bullets([
    "**Find** past theses by topic, method, author, adviser, or year.",
    "**Summarize and compare** archived studies with numbered citations.",
    "**Check** whether a proposed topic overlaps with existing work (faculty and administrators).",
    "**Build** the archive by uploading approved manuscripts (administrators).",
])
h2("1.2 What IskAI Does Not Do")
bullets([
    "**It never shows or downloads full manuscripts.** The library shows titles, authors, advisers, "
    "panel members, and abstracts only. The full text stays private to protect the authors; you can ask "
    "IskAI about it instead.",
    "**It does not write academic work for you.** IskAI will not write thesis chapters, assignments, "
    "proposals, hypotheses, or literature reviews. It helps you discover and cite what the archive contains.",
    "**It does not answer from the internet.** If the archive has nothing relevant, IskAI says so instead "
    "of guessing.",
    "**Its similarity results are advice, not verdicts.** A high-overlap flag means a faculty member should "
    "compare the studies; it is not a plagiarism finding.",
])
h2("1.3 User Roles")
para("What you can see and do depends on your role. Table 2 shows the default access. A superadmin can "
     "turn individual features on or off for students and faculty (see Section 5.4), so your menu may differ.")
table(["Feature (menu name)", "Guest", "Student", "Faculty", "Admin / Superadmin"], [
    ["Ask IskAI (chat)", "Yes, not saved", "Yes", "Yes", "Yes"],
    ["Thesis Library", "No", "Yes", "Yes", "Yes"],
    ["Novelty Review", "No", "No", "Yes", "Yes"],
    ["Ingest Thesis (upload)", "No", "No", "No", "Yes"],
    ["Operations (administration)", "No", "No", "No", "Yes"],
    ["Settings", "No", "Yes", "Yes", "Yes"],
], [2.0, 1.0, 0.9, 0.9, 1.2], "Default features by role")
h2("1.4 System Requirements")
bullets([
    "A current version of Google Chrome, Microsoft Edge, Mozilla Firefox, or Safari, on a computer, tablet, or phone.",
    "A stable internet connection.",
    "An email address you can open, for verification codes.",
    "Administrators: an authenticator app on a phone (for example Google Authenticator, 1Password, or Bitwarden).",
])

# ================================================================ CH 2
h1("2. Getting Started")
h2("2.1 Open IskAI")
steps([
    ("Open your web browser and go to the IskAI address given by CCSICT.",
     "The home page opens with the heading **Every ISU thesis, one intelligent answer.**"),
])
figure("01_landing_hero", "IskAI home page")
para("From the home page you can:")
bullets([
    "Click **Try as Guest Researcher** or **Try guest chat** to ask questions without an account (Section 3.1).",
    "Click **Sign in →** or **Sign in or create account** to sign in or register.",
    "Click the palette icon to change colours and motion (Section 6.2).",
])

h2("2.2 Create an Account")
task("Register as a student or faculty adviser",
     "Create an account to save conversations and use the Thesis Library.",
     "Have an email address you can open now; IskAI sends you a 6-digit code.",
     [
         "On the home page, click **Sign in or create account**.",
         "Click the **Create account** tab.",
         "Enter your **Full name** and **Email**. The **Department** field is fixed to **CCSICT** and cannot be changed.",
         "Under **Account Type**, choose **Student** or **Faculty (needs approval)**.",
         ("Enter a **Password**, then type it again in **Confirm password**.",
          "The strength meter must show that the password has **8+ characters**, an **Uppercase letter**, a **Number**, and a **Symbol**."),
         ("Click **Create my account →**.", "The **Verify your email** screen opens."),
         ("Open your email, find the 6-digit code from IskAI, and type it into the six boxes.",
          "The code is checked automatically; you can also click **Verify my email**."),
     ],
     "Student accounts open right away. Faculty accounts wait for administrator approval (Section 2.4).")
figure("04_login_signup", "The Create account tab")
callout("TIP", "No code? Check your spam folder. After 60 seconds you can click **Resend email**.")

h2("2.3 Sign In")
task("Sign in with your email and password",
     "Every sign-in has two parts: your password, then a second check that proves it is you.",
     "You need an approved account.",
     [
         "Go to the sign-in page (click **Sign in →** on the home page).",
         "Enter your **Email** and **Password**, then click **Sign in →**.",
         ("On the **Verify it's you** screen, choose a method:", None),
     ],
     None)
bullets([
    "**Email me a code**: IskAI emails a 6-digit code. Type it in and click **Verify & continue**.",
    "**Authenticator app**: type the 6-digit code shown in your authenticator app. This option is available only after you set up two-factor authentication (Section 6.4).",
])
para("**Result:** You see **Welcome, <your name>!** and IskAI opens your **Dashboard**.")
figure("03_login_signin", "The Sign in tab")
callout("IMPORTANT", "Administrators who have an authenticator app go straight to the authenticator code. "
        "Administrators who sign in with an emailed code cannot use uploads, novelty scanning, or "
        "Operations until they verify with an authenticator (Section 5.1).")

task("Sign in with an email link (no password)",
     "Use this if you remember your email but not your password and want to get in quickly.",
     "Your account must already exist.",
     [
         "On the sign-in page, enter your **Email** and click **Email me a login link**.",
         ("On the **Check your inbox** screen, click **Go to email ↗**, open the message from IskAI, and click the link.",
          "You are signed in."),
     ])
callout("NOTE", "This option sends a clickable link, not a code. If nothing arrives, click **Resend link** after the timer ends.")

task("Reset a forgotten password",
     "Set a new password using a code sent to your email.",
     None,
     [
         "On the sign-in page, click **Forgot password?**.",
         "Enter your **Email** and click **Send verification code**.",
         "Type the 6-digit code from your email and click **Verify Code**.",
         ("Enter a strong **New Password** and click **Update password**.",
          "You see **Password updated successfully**, and IskAI signs you in."),
     ])
figure("05_login_forgot", "Reset your password")

h3("Sign-in messages you may see")
table(["Message", "What it means", "What to do"], [
    ["Incorrect email or password.", "The email or password is wrong.", "Check Caps Lock (IskAI warns **Caps Lock is on**) and try again, or reset your password."],
    ["Too many attempts", "Sign-in is paused to protect the account.", "Wait for the countdown to finish; do not keep trying."],
    ["That code didn't match.", "The 6-digit code is wrong or old.", "Authenticator codes change every 30 seconds; use the current one."],
    ["That code has expired.", "The emailed code is too old.", "Click **Resend code** and use the new one."],
    ["This email isn't verified yet", "You did not finish registration.", "Enter the code from your verification email, or request a new one."],
    ["Confirm you are human", "A Cloudflare security check needs your input.", "Complete the check shown on screen."],
], [1.8, 2.0, 2.2], "Common sign-in messages")

h2("2.4 Understand Your Account Status")
table(["Screen", "Why you see it", "What to do"], [
    ["**Pending Approval**", "Your account is waiting for an administrator. All faculty accounts need approval.", "Wait for approval, then sign in again. Click **Sign out** to leave."],
    ["**Application Rejected**", "An administrator rejected your requested role.", "Contact your department if you think this is a mistake."],
    ["**Profile temporarily unavailable**", "IskAI could not confirm your role and department.", "Click **Reload**. If it continues, try again later."],
], [1.7, 2.3, 2.0], "Account status screens")

h2("2.5 Find Your Way Around")
para("After you sign in, the **Dashboard** opens. The menu is on the left on a computer, an icon rail on a "
     "tablet, and a bottom bar on a phone (tap **More** for every item).")
figure("11_dashboard", "The Dashboard and main menu (student view; faculty and administrators see more menu items)")
figure("19_dashboard_mobile", "The Dashboard on a phone (student view), with the bottom menu bar", width=2.6)
table(["Menu item", "Short name (phone)", "What it is for", "Section"], [
    ["**Dashboard**", "Home", "Archive totals, quick actions, recent chats and theses", "2.5"],
    ["**Ask IskAI**", "IskAI", "Ask research questions with cited answers", "3.1"],
    ["**Thesis Library**", "Library", "Search and filter the thesis catalog", "3.2"],
    ["**Novelty Review**", "Novelty", "Check a proposal against the archive", "4"],
    ["**Ingest Thesis**", "Upload", "Add manuscripts to the archive", "5.2"],
    ["**Operations**", "Admin", "Users, statistics, and system settings", "5.3–5.5"],
], [1.4, 1.1, 2.6, 0.9], "Main menu items")
para("The Dashboard shows:")
bullets([
    "Archive totals: **Theses indexed**, **Academic tracks**, **Years covered**, and **Last 5 years** (administrators see **Semantic chunks**).",
    "**Start a research inquiry**: type a question and click **Search with IskAI**, or click a **Try asking:** chip.",
    "Quick action cards for each feature you can use.",
    "**Recent conversations** (your last three chats) and **Recent theses**.",
])
h3("Use Quick access (Ctrl + K)")
steps([
    "Press **Ctrl + K** (⌘ + K on a Mac), or click **Quick access**.",
    "Type part of a destination, such as \"library\" or \"security\".",
    ("Press **Enter** to open the first match.", "IskAI opens that page or setting."),
])
h3("Check system status")
para("The dot near the bottom of the menu shows **Online**, **Degraded**, or **Offline**. If it is not "
     "**Online**, some answers or uploads may be slow or unavailable.")

h2("2.6 Sign Out and Automatic Sign-Out")
task("Sign out", "End your session, especially on a shared computer.", None,
     ["Click the log-out icon next to your name at the bottom of the menu (on a phone, open **More** first).",
      ("", "You return to the home page.")][:1],
     "You return to the home page.")
para("For your security, IskAI signs you out automatically:")
table(["Rule", "Students and faculty", "Administrators"], [
    ["No clicks, taps, or key presses for", "30 minutes", "15 minutes"],
    ["Maximum session length", "12 hours", "12 hours"],
], [2.6, 1.7, 1.7], "Automatic sign-out rules")
para("One minute before an idle sign-out, the **Still there?** window appears with a countdown. Click "
     "**Stay signed in** (or press any key) to continue. After you sign in again, IskAI returns you to the "
     "page you were on. Moving the mouse alone does not count as activity.")

# ================================================================ CH 3
h1("3. Everyday Tasks")
h2("3.1 Ask IskAI")
para("**Ask IskAI** answers questions using only the archived CCSICT theses. Each answer includes numbered "
     "citations and an **Evidence sources** list.")
figure("12_chat_answer", "An Ask IskAI answer with evidence sources")
task("Ask a question",
     "Get a cited answer about past research.",
     "Signed-in users and guests can both ask. Guests may need to pass a one-time security check.",
     [
         "Click **Ask IskAI** in the menu.",
         "Type your question in the box (**Ask IskAI about CCSICT thesis research…**), or click one of the starter questions.",
         ("Press **Enter** or click **Send**.",
          "The IskAI logo shows moving dots while it searches the archive."),
         "Read the answer. Numbers such as [1] point to the matching card under **Evidence sources**.",
     ],
     "The answer appears with its sources. For signed-in users, the conversation is saved under **Conversations**.")
callout("TIP", "Ask about the archive, not for new writing. Good examples: \"Which theses used CNNs for crop "
        "disease detection?\", \"Compare the methods of studies on attendance monitoring.\" Name a method, "
        "track, year range, or author for sharper results.")
h3("Narrow the search")
bullets([
    "Use the recency menu: **All theses** or **Last 5 years**.",
    "Use the category menu: **All categories**, **Student Thesis**, or **Faculty Research**.",
])
h3("Read the evidence sources")
para("Each source card shows the title, authors, year, track, the matching passages with page numbers, and "
     "a **% match** score. On each card you can:")
bullets([
    "Click **Cite APA** to copy an APA 7th citation.",
    "Click **Save** to add the study to your reading list (shared with the Thesis Library).",
])
callout("NOTE", "Source cards do not open the manuscript. Full texts stay private; ask a follow-up question instead.")
h3("Work with an answer")
table(["To…", "Do this"], [
    ["Get a new version of the answer", "Click **Redo response**."],
    ["Copy the answer", "Click **Copy response**, or **More response actions** → **Copy with sources**."],
    ["Save the answer as a file", "**More response actions** → **Download research note** (saves a .txt file)."],
    ["Hear the answer read aloud", "**More response actions** → **Listen**."],
    ["See how the answer was produced", "**More response actions** → **See response details**."],
    ["Change your question", "Point to your question and click **Edit prompt**, change it, then click **Update**. Later turns are replaced."],
    ["Stop a slow answer", "Click the stop button (**Stop waiting for this response**). Your question is kept."],
], [2.3, 3.7], "Answer actions")
h3("Manage conversations (signed-in users)")
steps([
    "Click **New conversation** (+) to start a fresh chat.",
    "Click a conversation in the **Conversations** list to reopen it.",
    "Click the pencil to **Rename** it (up to 120 characters), or the trash icon to delete it.",
])
callout("WARNING", "Deleting a conversation permanently removes all of its messages. To delete every "
        "conversation at once, use **Settings** → **Chat & AI** → **Clear all** (Section 6.3).")
h3("Messages IskAI may give instead of an answer")
table(["Message (beginning)", "Meaning", "What to do"], [
    ["No relevant thesis was found…", "The archive has no study on that topic.", "Rephrase with different technical terms or try another topic."],
    ["I couldn't identify a thesis topic…", "The question is too vague.", "Name a topic, title, author, method, or finding."],
    ["I can help you discover, compare, summarize, and cite…", "You asked IskAI to write academic work.", "Ask what the archive contains about your topic instead."],
    ["Potential topic duplication — NN% similarity", "Your topic is at least 85% similar to an archived study.", "Discuss with your faculty adviser; consider building on that work."],
    ["IskAI has reached the research AI service usage limit…", "The AI service is busy or out of quota.", "Try again later."],
    ["IskAI could not answer", "A connection or service error occurred.", "Click **Retry**, or **Edit** your question."],
], [2.1, 1.9, 2.0], "Non-answer messages")
figure("12_chat_error", "The IskAI could not answer banner, with Edit and Retry")
h3("Using IskAI as a guest")
bullets([
    "Click **Try guest chat** on the home page. A banner reads **Guest Researcher · CCSICT archive only · chats aren't saved**.",
    "The first time, you may see **Confirm you're human to send**. One check unlocks guest chat for the rest of your browser session.",
    "Guest questions share a daily allowance. When it is used up, IskAI asks you to sign in or try again tomorrow.",
    "Click **Sign in to save chats** to keep your conversations.",
])
figure("07_guest_chat", "Guest chat")

h2("3.2 Browse the Thesis Library")
para("The **Thesis Library** (page title **Thesis Archive**) is a catalog of every indexed thesis. It shows "
     "details and abstracts, never full manuscripts.")
figure("13_library", "The Thesis Archive with filters (student view)")
task("Search for a thesis",
     "Find studies by words in the title, authors, abstract, or adviser.",
     "You need a student, faculty, or administrator account.",
     [
         "Click **Thesis Library** in the menu.",
         ("Type in the search box (**Search titles, authors, abstracts, advisers…**).",
          "Results update as you type. Every word must match."),
         "Optional: choose a category tab (**All**, **Student Theses**, **Faculty Research**) and use the **Program**, **Specialization**, **Year**, and **Adviser** menus.",
         "Optional: change the order with the **Sort** menu (for example **Sort: Newest first** or **Sort: Most relevant**).",
     ],
     "The bar shows **Showing X of Y indexed theses**. Use the page controls or **Go to page** for more results (6 per page).")
callout("TIP", "Each active filter appears as a chip under **Active**. Click its X to remove it, or "
        "**Clear all** to start over. The address bar keeps your filters, so you can bookmark a search.")
task("View a thesis record",
     "Read the full details and abstract of one study.", None,
     [
         ("Click a thesis card (or **Details ›**).",
          "A window shows the authors, adviser, panel chair, panel members, abstract, and, if the study was flagged at upload, a **Duplication screening** panel."),
         "Click **Copy APA 7th** or **Copy BibTeX** to copy a citation.",
         "Click **Ask IskAI about this study** to ask questions about it in chat.",
     ],
     after=lambda: figure("13b_library_record", "A thesis record with its duplication screening panel"))
task("Build and export a reading list",
     "Collect studies you want to cite.", None,
     [
         "Click the bookmark icon on a card (**Save to reading list**).",
         "Click **Saved (N)** to show only your saved studies.",
         ("Click **Export APA (.txt)**.",
          "IskAI downloads `iskai-reading-list-apa.txt` with APA 7th and BibTeX entries."),
     ])
task("Compare up to three studies",
     "Have IskAI compare two or three theses side by side.", None,
     [
         "Click the layers icon (**Select to compare (up to 3)**) on two or three cards.",
         ("In the **Compare studies** tray, click **Compare in IskAI**.",
          "Ask IskAI opens with a comparison of the selected studies."),
     ])

# ================================================================ CH 4
h1("4. Faculty Tasks: Novelty Review")
para("**Novelty Review** (page title **Novelty Check**) compares a proposal or draft with the whole archive "
     "and reports how much of it points to a single archived thesis. It is available to faculty and "
     "administrators.")
callout("IMPORTANT", "The result is a **similarity advisory, not a plagiarism verdict**. It measures topic "
        "similarity, not copied wording. Faculty review remains required.")
h2("4.1 Choose a Scan Mode")
table(["Mode", "Use it for", "Accepts"], [
    ["**Single**", "One manuscript, one advisory report.", "PDF or TXT, up to 25 MB"],
    ["**Batch**", "Up to 10 manuscripts scanned one after another.", "PDF or TXT, up to 25 MB each"],
    ["**Capsule**", "A proposal before the manuscript exists; each section is checked on its own.", "Typed text, or a PDF, DOCX, or TXT file"],
], [1.1, 3.0, 1.9], "Novelty scan modes")
figure("14_novelty_page", "The Novelty Check page in Single mode, with Scan history")
h2("4.2 Scan One Manuscript")
task("Run a single scan", "Check one proposal or draft against the archive.",
     "The file must be a PDF or plain-text file of 25 MB or less. Password-protected PDFs are refused.",
     [
         "Click **Novelty Review** in the menu and select **Single**.",
         "Optional: set the recency menu to **All theses** or **Last 5 years**.",
         ("Drag the file onto **Drop a proposal or draft to scan**, or click it to browse.",
          "IskAI shows **Scanning against the archive…**. Long drafts can take about a minute."),
     ],
     "A report opens and the scan is saved under **Scan history**.")
figure("14_novelty_report", "A novelty scan report (the sample was an already-archived thesis, so it shows 100% High overlap)")
h2("4.3 Read the Scan Report")
para("The main figure is **Closest single thesis**: the share of matched passages that point to one archived thesis.")
table(["Closest single thesis", "Verdict", "What it means"], [
    ["Under 25%", "**Clear**", "No single archived thesis accounts for much of this one."],
    ["25% to under 70%", "**Review suggested**", "A noticeable share points to one archived thesis. Worth a look."],
    ["70% and over", "**High overlap—faculty review required**", "Most of it points to one archived thesis; a faculty reviewer should compare the two."],
], [1.5, 2.0, 2.5], "Novelty verdicts")
para("The report also shows **Highest passage**, **Matched anywhere**, and **Matched chunks**, and has three tabs:")
bullets([
    "**Matches**: up to three most similar archived theses with their similarity percentage.",
    "**Explanation**: a plain-language summary of the overlap written by the AI.",
    "**Ask**: ask follow-up questions, for example \"Which chapter overlaps the most?\" or \"How can the student differentiate their study?\"",
])
figure("14b_novelty_explanation", "The Explanation tab of a novelty report")
task("Download the official report", "Produce a Word report for endorsement.", None,
     [
         "Click **Signatories** and fill in **Prepared / Screened by (Adviser)**, **Noted & Endorsed by (Dean)**, and **Dean Title / College**.",
         ("Click **Download report (.docx)**.",
          "IskAI downloads the official novelty report. It contains metadata only, never manuscript excerpts."),
     ])
h2("4.4 Scan Several Manuscripts (Batch)")
steps([
    "Select **Batch**.",
    "Drop up to 10 PDF or TXT files onto **Drop several proposals or drafts**.",
    ("Click **Scan N manuscripts**.",
     "Files are scanned one at a time. Rows show **Waiting**, **Scanning…**, or the verdict and percentage. Busy or rate-limited files retry automatically."),
    "Click **View** on a row to open its report. Use **Retry failed** for files that failed.",
])
para("To stop early, click **Stop after this file**. Every finished file is also saved in **Scan history**.")
h2("4.5 Check a Research Capsule")
task("Check a proposal capsule", "Check a topic before a full manuscript exists.", None,
     [
         "Select **Capsule**.",
         "Type the **Working title**, **Rationale and significance**, **Research questions / objectives**, and **Methodology**. Or click **Upload capsule** to fill the form from a PDF, Word (.docx), or text file, then review what was filled in.",
         ("Click **Check capsule**.",
          "IskAI reports how many sections were flagged and which archived study each section is closest to."),
     ])
callout("NOTE", "The working title needs at least 5 characters and each section at least 40 characters. "
        "Fill in all four fields; the form will not submit with an empty section. Timeline and budget are not needed. "
        "Your draft is saved in the browser automatically.")
h2("4.6 Manage Scan History")
bullets([
    "**Scan history** lists your 50 most recent scans. Click one to reopen its report.",
    "Click the X on a row and confirm **Remove scan** to delete one scan.",
    "Click **Clear all** to delete every scan record.",
])
callout("WARNING", "Removed scans and their advisory reports are deleted permanently.")

# ================================================================ CH 5
h1("5. Administrator Tasks")
para("This chapter is for administrators and superadmins. Administrators work within their own department; "
     "superadmins can work across departments and change system-wide settings.")
h2("5.1 Secure Your Administrator Session")
para("The **Operations** page, thesis uploads, and novelty scanning require a session verified with an "
     "authenticator app. If your session is not verified, you see one of these screens:")
table(["Screen", "What to do"], [
    ["**Secure administrator access**", "Click **Open security settings**, set up two-factor authentication (Section 6.4), then sign in again."],
    ["**Verify your administrator session**", "Click **Verify with authenticator** and enter the current 6-digit code."],
    ["**Two-factor authentication required** (pop-up)", "Enter your authenticator code, or click **Set up authenticator**. Your place is kept."],
    ["**Security status unavailable**", "Click **Retry security check**."],
], [2.4, 3.6], "Administrator security screens")

h2("5.2 Add Theses to the Archive")
para("Click **Ingest Thesis** in the menu (page title **Upload Thesis**).")
task("Upload one thesis",
     "Index an approved manuscript so users can find and ask about it.",
     "Have the final PDF (25 MB or less, up to 500 pages, not password-protected). Scanned pages are read with OCR.",
     [
         "**Manuscript**: drag the PDF onto **Drop the manuscript here**, or click to browse.",
         ("In **Read metadata from this manuscript?**, click **Confirm**.",
          "IskAI fills in the title, authors, adviser, and year from the front matter. Click **Cancel** to type everything yourself."),
         "Under **Abstract**, choose **In document** (the manuscript's own abstract) or **AI extended** (a longer AI summary). Click **Continue**.",
         "**Metadata**: check every field. Fields marked **autofilled** came from the PDF; a grey note explains any field it could not fill. Complete **Thesis title**, **Authors**, **Year completed**, **Adviser**, **Panel chair**, **Panel members**, **Thesis category**, **Academic program**, **Specialization** (if shown), and **Abstract**. Click **Review**.",
         "**Review**: confirm the summary. Click **Ingest into archive**.",
         ("Watch the pipeline: **Secure source**, **Malware scan**, **Extract & clean**, **Chunk (800 tokens)**, **Embed (768d)**, **Screen novelty (85%)**, **Index vectors**.",
          "You can leave or refresh the page; the job keeps running."),
     ],
     "**Thesis indexed!** appears with the number of chunks. Click **View archive** or **Upload another**.")
figure("15_upload_metadata", "Upload Thesis, Metadata step")
callout("NOTE", "**Academic program** is not required for **Faculty Research**. The **Department** is locked "
        "to your own department unless you are a superadmin.")
h3("Upload outcomes")
table(["Outcome", "Meaning", "What to do"], [
    ["**Thesis indexed!**", "The thesis is in the archive.", "Nothing more."],
    ["**Review suggested** / **High overlap—faculty review required**", "Indexed, but similar to an archived thesis. Advisory only.", "Click **Open Novelty Review** if faculty should compare the studies."],
    ["**Already in the archive**", "Every passage matches an existing thesis; it was not indexed again.", "No action needed."],
    ["**Ingestion failed**", "The file could not be processed (for example unreadable scanned pages, no extractable text, or a failed malware scan).", "Read the message, fix the file, and click **Try again**."],
    ["**Upload cancelled**", "You cancelled; nothing was indexed.", "Click **Start a new upload**."],
], [1.8, 2.3, 1.9], "Upload outcomes")
callout("WARNING", "Click **Cancel upload** only if you mean it. The manuscript will not be indexed, and you "
        "must start a new upload to submit it again.")
task("Upload several theses (batch)",
     "Index up to 20 manuscripts at once.", None,
     [
         "On **Upload Thesis**, click **Batch upload**.",
         "Drop up to 20 PDFs (25 MB each) and click **Continue**. IskAI reads each title page.",
         "In **Shared details**, set the **Thesis category** (and **Department**, superadmins only).",
         "Check each manuscript card. Use **Same program for all** → **Apply to all rows** to save time. Remove rows marked **Rejected**.",
         ("Click **Ingest N manuscripts**.",
          "A progress table shows each file's status. Rows marked **Failed** or **Not accepted** can be resubmitted individually."),
     ])
h3("Remove a thesis from the archive")
steps([
    "Open **Thesis Library** and find the thesis.",
    "Click the trash icon on its card.",
    ("Click **Delete** in **Remove thesis from the archive?**.",
     "The thesis and its search data are permanently deleted."),
])
callout("WARNING", "Deleting a thesis cannot be undone. Administrators can delete only theses from their own department.")

h2("5.3 Monitor the System (Operations)")
para("Click **Operations** in the menu (page title **Research Administration**).")
figure("16_admin_overview", "Research Administration, Overview tab")
table(["Tab", "Who sees it", "What it shows"], [
    ["**Overview**", "Admin, Superadmin", "Theses indexed, vector chunks, AI queries, registered users; charts per track and year; novelty scanning totals; recent activity; user roles."],
    ["**Upload history**", "Admin, Superadmin", "A searchable, read-only table of archived theses, who uploaded them, and when."],
    ["**System Management**", "Admin, Superadmin", "User directory, system logs, retention policy; superadmins also see feature, security, and department settings."],
    ["**Operations**", "Superadmin only", "Worker health, queued and failed jobs, alerts, and a retention dry run."],
], [1.5, 1.3, 3.2], "Operations tabs")

h2("5.4 Manage Users")
task("Approve or reject an account",
     "Give a pending user (for example a faculty adviser) access, or refuse it.", None,
     [
         "Open **Operations** → **System Management** → **User Directory**.",
         "Set **All Status** to **Pending** to list waiting accounts.",
         ("Click **Approve** or **Reject** on the user's row, then confirm.",
          "The user's access updates immediately."),
     ])
task("Change a user's role or details", "Correct a name, role, or department.", None,
     [
         "In **User Directory**, click the edit (user) icon on the row.",
         "Change the name, role, status (superadmin only), or department.",
         "Click the save icon.",
     ])
para("You can also change a role from **Overview** → **User roles**.")
callout("NOTE", "Administrators cannot change or delete administrator or superadmin accounts, cannot move "
        "users to another department, and nobody can change their own account here.")
callout("WARNING", "**Permanently delete user?** cannot be undone. To remove an account, prefer **Reject** unless deletion was requested.")
h3("Turn features on or off for a role (superadmin)")
steps([
    "Open **System Management** → **Role Feature Permissions**.",
    ("For **Student** or **Faculty**, switch **AI Chat**, **Archive**, **Novelty Check**, or **Upload Thesis** on or off.",
     "The change saves immediately and the menu updates for that role."),
])
h3("Other superadmin settings")
bullets([
    "**Global Upload Security**: turns the ClamAV malware check on or off for every upload type. Turning it off asks you to confirm.",
    "**Departments & Tracks Configuration**: add, edit, or delete departments and their tracks.",
])
callout("CAUTION" if False else "WARNING", "Turning off malware scanning affects every user. Leave it **On** unless instructed by the system maintainer.")

h2("5.5 Review Logs and Operations")
bullets([
    "**Raw System Logs** (System Management) lists the latest 200 events.",
    "**Recent activity** (Overview) shows AI queries, uploads, deletions, novelty scans, and role changes.",
    "On the **Operations** tab (superadmin), click **Acknowledge** on an open alert after you have dealt with it. The **Retention dry run** only counts records; it never deletes anything.",
])

# ================================================================ CH 6
h1("6. Account and Settings")
para("Click **Settings** (the gear icon, or your name in the menu). Settings has six sections: **Profile**, "
     "**Appearance**, **Chat & AI**, **Security**, **Data & privacy**, and **About**.")
figure("17_settings_security", "Settings, Security section")
h2("6.1 Update Your Profile")
steps([
    "Open **Settings** → **Profile**.",
    "Click the camera button to upload a photo (JPG, PNG, or WebP, up to 2 MB), or **Remove photo**.",
    ("Change your **Full name** and click **Save**.", "You see **Profile updated successfully**."),
])
para("Your email, role, department, and join date are set by an administrator and cannot be changed here.")
h2("6.2 Change the Appearance")
para("Open **Settings** → **Appearance**, or click the palette icon anywhere. Changes apply to this device only.")
table(["Setting", "Choices"], [
    ["**Color mode**", "System, Light, Dark"],
    ["**Tonal palette**", "ISU Classic, Emerald, Golden"],
    ["**Motion**", "Follow device, Full motion, Reduced motion"],
    ["**Visual effects**", "Balanced, Full glass and 3D, Low energy"],
    ["**Contrast**", "Standard Material contrast, High contrast"],
], [2.0, 4.0], "Appearance settings")
figure("18_settings_appearance", "Settings, Appearance section")
callout("TIP", "On an older computer or phone, choose **Low energy** and **Reduced motion** for a faster, calmer screen. Click **Reset** to return to the defaults.")
h2("6.3 Set Chat Preferences")
bullets([
    "**Default category filter**: the category new chats start with.",
    "**Press Enter to send**: when off, Ctrl + Enter sends and Enter adds a new line.",
    "**Clear all conversations**: click **Clear all** and confirm to delete every saved conversation.",
])
h2("6.4 Set Up Two-Factor Authentication")
para("Two-factor authentication (2FA) adds a code from your phone to every sign-in, so a stolen password alone "
     "cannot open your account. It is **required** for administrators.")
task("Turn on 2FA", "Link an authenticator app to your IskAI account.",
     "Install an authenticator app on your phone, such as Google Authenticator, 1Password, or Bitwarden.",
     [
         "Open **Settings** → **Security** and click **Enable 2FA** (you can also click **Enable 2FA** on the Dashboard banner).",
         "Click **Set up 2FA**.",
         "In your authenticator app, scan the QR code. If you cannot scan it, click **Can't scan it? Enter this secret** and type the secret into the app.",
         ("Type the 6-digit code the app shows next to IskAI, then click **Activate 2FA**.",
          "You see **Two-factor authentication enabled**."),
     ])
callout("WARNING", "If you lose the phone with your authenticator app, ask an administrator for help. "
        "Before you change phones, move your authenticator accounts to the new phone.")
h2("6.5 Change Your Email or Password")
steps([
    "Open **Settings** → **Security**.",
    "Enter the new **Email address** or **New password** and click **Update**.",
    ("Enter the 6-digit code sent to your email and click **Verify** (email) or **Verify & Save** (password).",
     "You see a success message."),
])
h3("Sign out of other devices")
para("In **Your devices**, click **Sign out** next to **Sign out other devices** if you lost a device or "
     "signed in on a public computer. Only this device stays signed in.")
h2("6.6 Privacy and Account Deletion")
para("IskAI stores only your name, email, role, and conversations. To delete your account, open **Settings** → "
     "**Data & privacy** and click **Contact administrator**. This opens an email to `ccsict@isu.edu.ph`.")

# ================================================================ CH 7
h1("7. Troubleshooting and FAQ")
h2("7.1 Troubleshooting")
table(["Problem", "Likely cause", "Solution"], [
    ["A menu item is missing.", "Your role does not include that feature.", "See Table 2. Ask an administrator if you need access."],
    ["I typed an address and returned to the Dashboard.", "That page is not available to your role.", "Use the items in your menu."],
    ["I see **Pending Approval**.", "Your account is waiting for an administrator.", "Wait for approval. Faculty accounts always need it."],
    ["My verification code does not arrive.", "Email delay or spam filter.", "Check spam, wait 60 seconds, then click **Resend**."],
    ["I was signed out.", "Idle limit (15 or 30 minutes) or 12-hour session limit.", "Sign in again; IskAI returns you to your page."],
    ["IskAI says no relevant thesis was found.", "The archive has no matching study.", "Use different technical terms or a broader topic."],
    ["IskAI is slow or says the service is busy.", "High demand or the AI service limit was reached.", "Wait a moment and click **Retry**. Check the status dot."],
    ["Something went wrong. Please try again.", "Too many requests in a short time, or a connection problem.", "Wait one minute, then try again."],
    ["Guest chat says the daily allowance is used up.", "The shared guest limit for the day is reached.", "Sign in with an account, or try tomorrow."],
    ["**Unsupported file** when scanning or uploading.", "Wrong file type or larger than 25 MB.", "Use a PDF (or TXT for scans) under 25 MB."],
    ["Upload failed: scanned pages could not be read.", "OCR is unavailable on the server.", "Tell the system maintainer; do not upload scanned PDFs until fixed."],
    ["Operations shows **Secure administrator access**.", "2FA is not set up or not verified.", "Set up 2FA (Section 6.4) and sign in again."],
    ["The page shows **404**.", "The address does not exist.", "Click **Back to home**."],
], [2.0, 2.0, 2.0], "Troubleshooting guide")
h2("7.2 Frequently Asked Questions")
faqs = [
    ("Can I download a full thesis PDF?", "No. IskAI shows details and abstracts only. Ask IskAI about the study, or contact the CCSICT library for the physical copy."),
    ("Are guest chats saved?", "No. Sign in to save conversations."),
    ("Is the similarity percentage a plagiarism score?", "No. It measures topic similarity. A faculty reviewer makes the final decision."),
    ("Why does every sign-in ask for a second step?", "To protect accounts. You can use an emailed code or an authenticator app."),
    ("Can I change my department or role?", "No. An administrator assigns them."),
    ("Can IskAI write my thesis chapter or literature review?", "No. It helps you find, summarize, compare, and cite archived studies."),
    ("Why do I see different menu items from my classmate?", "Menus depend on role, and a superadmin can change features per role."),
]
for q, a in faqs:
    para(f"**Q: {q}**", after=0)
    para(f"A: {a}")

# ================================================================ APPENDICES
h1("Appendix A. Glossary")
table(["Term", "Meaning"], [
    ["Archive", "The collection of indexed CCSICT theses and faculty research."],
    ["Citation", "A numbered reference such as [1] that links a statement to its source study."],
    ["Chunk / passage", "A short section of a manuscript used for searching (about 800 tokens)."],
    ["Closest single thesis", "In a novelty scan, the share of matched passages that point to one archived thesis."],
    ["Guest Researcher", "A visitor who uses Ask IskAI without signing in."],
    ["Indexed", "Processed and added to the archive so it can be searched."],
    ["OCR", "Optical character recognition: reading text from scanned page images."],
    ["RAG", "Retrieval-Augmented Generation: IskAI first finds relevant passages, then writes an answer from them."],
    ["Two-factor authentication (2FA)", "A second sign-in step using a code from an authenticator app."],
], [2.0, 4.0])
h1("Appendix B. Quick Reference")
table(["I want to…", "Go to", "Section"], [
    ["Ask a research question", "**Ask IskAI**", "3.1"],
    ["Find a thesis", "**Thesis Library** → search box", "3.2"],
    ["Cite a study", "Source card **Cite APA**, or record **Copy APA 7th**", "3.1, 3.2"],
    ["Export my reading list", "**Thesis Library** → **Saved** → **Export APA (.txt)**", "3.2"],
    ["Check a proposal for overlap", "**Novelty Review** → **Single** or **Capsule**", "4.2, 4.5"],
    ["Upload a thesis", "**Ingest Thesis**", "5.2"],
    ["Approve a faculty account", "**Operations** → **System Management**", "5.4"],
    ["Turn on 2FA", "**Settings** → **Security** → **Enable 2FA**", "6.4"],
    ["Change theme", "Palette icon or **Settings** → **Appearance**", "6.2"],
    ["Open anything fast", "Ctrl + K (Quick access)", "2.5"],
], [2.2, 2.9, 0.9])
h1("Appendix C. Getting Help")
para("For account approval, role changes, lost authenticator access, or account deletion, contact the CCSICT "
     "administrator at `ccsict@isu.edu.ph`.")
para("College of Computing Studies, Information and Communication Technology\nIsabela State University\nEchague, Isabela")

# ---------------------------------------------------------------- footer page numbers
for s in doc.sections:
    fp = s.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("IskAI User Manual · Page "); r.font.size = Pt(9)
    field(fp, "PAGE")
    for rr in fp.runs:
        rr.font.size = Pt(9)

doc.save(OUT)
print(f"saved {OUT}")
print(f"figures={FIG[0]} tables={TAB[0]} missing_screenshots={len(MISSING)}: {MISSING}")
