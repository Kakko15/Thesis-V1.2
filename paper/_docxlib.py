"""Minimal, lossless .docx read/write helpers.

Deliberately avoids XML reserialization: OOXML round-tripped through
ElementTree loses its `w:` namespace prefixes unless every prefix is
re-registered, and Word rejects some of what ET emits. All edits here are
string surgery on word/document.xml, so every byte we do not touch is
preserved exactly, including the 8 embedded images.
"""
import re, shutil, zipfile, html

DOC = 'word/document.xml'

def read_xml(path, part=DOC):
    with zipfile.ZipFile(path) as z:
        return z.read(part).decode('utf8')

def write_xml(src, dst, xml, part=DOC):
    """Rewrite one part, copying every other entry byte-for-byte in order."""
    if src != dst:
        shutil.copyfile(src, dst)
    with zipfile.ZipFile(src) as zin:
        infos = zin.infolist()
        data = {i.filename: zin.read(i.filename) for i in infos}
    data[part] = xml.encode('utf8')
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for i in infos:
            zi = zipfile.ZipInfo(i.filename, date_time=i.date_time)
            zi.compress_type = i.compress_type
            zi.external_attr = i.external_attr
            zout.writestr(zi, data[i.filename])

def paragraphs(xml):
    """(start, end, xml) for every <w:p> in document order."""
    return [(m.start(), m.end(), m.group(0))
            for m in re.finditer(r'<w:p(?: [^>]*)?>.*?</w:p>', xml, re.S)]

def ptext(pxml):
    """Visible text of one paragraph."""
    return html.unescape(''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', pxml, re.S)))

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def replace_text(xml, old, new, expect=None, label=''):
    """Replace `old` with `new` in paragraph-visible text.

    Two strategies, narrowest first:
      * in-run   -- `old` sits inside a single <w:t>; only that text node is
                    touched, so every bold/italic run in the paragraph survives.
      * flatten  -- `old` spans runs (Word splits text arbitrarily). The whole
                    new paragraph text goes into the first <w:t> and the rest are
                    emptied, which keeps the paragraph's own formatting but
                    collapses intra-paragraph runs. Reported so it can be checked.
    """
    hits = {'in_run': 0, 'flatten': 0}
    out, last = [], 0
    for s, e, p in paragraphs(xml):
        if old not in ptext(p):
            continue
        tnodes = list(re.finditer(r'(<w:t[^>]*>)(.*?)(</w:t>)', p, re.S))
        if not tnodes:
            continue
        # narrow path: some single text node contains the whole needle
        idx = next((i for i, m in enumerate(tnodes)
                    if old in html.unescape(m.group(2))), None)
        if idx is not None:
            m = tnodes[idx]
            fixed = esc(html.unescape(m.group(2)).replace(old, new))
            newp = p[:m.start(2)] + fixed + p[m.end(2):]
            hits['in_run'] += 1
        else:
            full = ptext(p).replace(old, new)
            first = tnodes[0]
            newp = p[:first.start(2)] + esc(full) + p[first.end(2):]
            # empty every later text node, walking backwards to keep offsets valid
            shift = len(esc(full)) - (first.end(2) - first.start(2))
            for m in reversed(tnodes[1:]):
                a, b = m.start(2) + shift, m.end(2) + shift
                newp = newp[:a] + newp[b:]
            hits['flatten'] += 1
        out.append(xml[last:s]); out.append(newp); last = e
    out.append(xml[last:])
    result = ''.join(out)
    total = hits['in_run'] + hits['flatten']
    if expect is not None and total != expect:
        raise AssertionError(
            f'{label or old!r}: expected {expect} paragraph(s), matched {total}')
    return result, hits


def replace_cell(xml, exact_old, new, expect=1, label=''):
    """Replace paragraphs whose *entire* visible text equals `exact_old`.

    Table cells are their own paragraphs, so this targets a cell precisely and
    cannot collide with the same token appearing inside a prose sentence --
    `text-embedding-004` is both a Table 3 cell and a word in four paragraphs.
    """
    out, last, n = [], 0, 0
    for s, e, p in paragraphs(xml):
        if ptext(p).strip() != exact_old:
            continue
        tnodes = list(re.finditer(r'(<w:t[^>]*>)(.*?)(</w:t>)', p, re.S))
        if not tnodes:
            continue
        first = tnodes[0]
        newp = p[:first.start(2)] + esc(new) + p[first.end(2):]
        shift = len(esc(new)) - (first.end(2) - first.start(2))
        for m in reversed(tnodes[1:]):
            a, b = m.start(2) + shift, m.end(2) + shift
            newp = newp[:a] + newp[b:]
        out.append(xml[last:s]); out.append(newp); last = e; n += 1
    out.append(xml[last:])
    if n != expect:
        raise AssertionError(f'{label or exact_old!r}: expected {expect} cell(s), matched {n}')
    return ''.join(out), n


def replace_cell_nth(xml, exact_old, new, nth, label=''):
    """Replace only the nth (0-indexed) cell whose whole text equals `exact_old`."""
    out, last, seen, done = [], 0, 0, False
    for s, e, p in paragraphs(xml):
        if ptext(p).strip() != exact_old:
            continue
        if seen != nth:
            seen += 1
            continue
        tnodes = list(re.finditer(r'(<w:t[^>]*>)(.*?)(</w:t>)', p, re.S))
        first = tnodes[0]
        newp = p[:first.start(2)] + esc(new) + p[first.end(2):]
        shift = len(esc(new)) - (first.end(2) - first.start(2))
        for m in reversed(tnodes[1:]):
            a, b = m.start(2) + shift, m.end(2) + shift
            newp = newp[:a] + newp[b:]
        out.append(xml[last:s]); out.append(newp); last = e
        seen += 1; done = True
        break
    out.append(xml[last:])
    if not done:
        raise AssertionError(f'{label or exact_old!r}: no cell #{nth}')
    return ''.join(out)


def replace_smart(xml, old, new, expect=1, label=''):
    """`replace_text` that tolerates the document's mixed apostrophe styles.

    Chapter 1/2 prose uses the curly U+2019 while Chapter 3 uses the straight
    U+0027, sometimes for the same phrase, so a literal needle silently matches
    only half the occurrences. Tries both spellings and requires the combined
    count to equal `expect`.
    """
    variants = {old, old.replace("'", '\u2019'), old.replace('\u2019', "'")}
    total, hits = 0, {'in_run': 0, 'flatten': 0}
    for v in variants:
        matched = sum(1 for _s, _e, p in paragraphs(xml) if v in ptext(p))
        if not matched:
            continue
        xml, h = replace_text(xml, v, new, expect=matched, label=label)
        total += matched
        hits['in_run'] += h['in_run']; hits['flatten'] += h['flatten']
    if total != expect:
        raise AssertionError(f'{label or old!r}: expected {expect}, matched {total}')
    return xml, hits


_T_RE = re.compile(r'(<w:t)([^>]*)(>)(.*?)(</w:t>)', re.S)

def _set_t(tag_open, attrs, gt, body):
    """Re-emit a <w:t>, forcing xml:space=preserve so edge spaces survive."""
    if 'xml:space' not in attrs:
        attrs += ' xml:space="preserve"'
    return f'{tag_open}{attrs}{gt}{body}</w:t>'

def replace_runs(xml, old, new, expect=1, label=''):
    """Replace `old` with `new` while preserving every run's own formatting.

    Word splits a sentence across many <w:r> runs, each carrying its own <w:rPr>.
    The earlier flatten strategy pushed the whole paragraph into run 1, which
    silently destroyed an italic run-in heading and a coloured closing sentence.
    This edits only the text nodes the needle actually overlaps: the first keeps
    its prefix and receives the replacement, interior ones lose their overlapped
    slice, the last keeps its suffix, and every other run is left byte-identical.
    """
    variants = [v for v in dict.fromkeys(
        (old, old.replace("'", '\u2019'), old.replace('\u2019', "'")))]
    out, last, total = [], 0, 0
    for s, e, p in paragraphs(xml):
        text = ptext(p)
        needle = next((v for v in variants if v in text), None)
        if needle is None:
            continue
        nodes, pos = [], 0
        for m in _T_RE.finditer(p):
            raw = html.unescape(m.group(4))
            nodes.append([m, pos, pos + len(raw), raw])
            pos += len(raw)
        a = text.index(needle); b = a + len(needle)
        edits, placed = [], False
        for m, ns, ne, raw in nodes:
            if ne <= a or ns >= b:
                continue                      # untouched run
            pre, suf = raw[:max(0, a - ns)], raw[max(0, b - ns):]
            body = pre + (new if not placed else '') + suf
            placed = True
            edits.append((m, esc(body)))
        newp = p
        for m, body in reversed(edits):       # back-to-front keeps offsets valid
            newp = newp[:m.start()] + _set_t(m.group(1), m.group(2), m.group(3), body) + newp[m.end():]
        out.append(xml[last:s]); out.append(newp); last = e; total += 1
    out.append(xml[last:])
    if total != expect:
        raise AssertionError(f'{label or old!r}: expected {expect}, matched {total}')
    return ''.join(out)
