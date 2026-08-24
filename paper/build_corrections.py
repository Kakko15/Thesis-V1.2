"""Rebuild paper_CORRECTED.docx from the untouched 2026-08-09 original.

Every edit is declared here with an expected match count, so a wording drift in
the source raises instead of silently skipping a correction. Re-runnable: it
always starts from the original, so it can never double-apply.

Ground truth comes from the repository, not from prose:
  rag-thesis-backend/requirements.lock, config.py, Dockerfile
  rag-thesis-frontend/package.json, package-lock.json
  .github/workflows/quality.yml, docs/evidence (SonarQube/JMeter)
"""
import _docxlib as D

SRC = 'paper_ORIGINAL_2026-08-09.docx'
DST = 'paper_CORRECTED.docx'

# --- Tables 1-4 and 6: version cells -------------------------------------
CELLS = [
    ('v19.2.5',  'v19.2.8',  'T1 React'),
    ('v8.0.8',   'v8.1.5',   'T1 Vite'),
    ('v0.135.3', 'v0.139.2', 'T2 FastAPI'),
    ('v2.12.5',  'v2.13.4',  'T2 Pydantic'),
    ('v0.0.24',  'v0.0.32',  'T2 python-multipart'),
    ('v2.28.3',  'v2.31.0',  'T3 supabase'),
    ('v4.2.1',   'v4.3.1',   'T3 langchain-google-genai'),
    ('Gemini 1.5 Flash', 'Gemini 3.6 Flash', 'T3 LLM name'),
    ('gemini-1.5-flash', 'gemini-3.6-flash', 'T3 LLM id'),
    ('v8.1.1',   'v9.1.1',   'T4 PyTest'),
    ('v10.4',    'Community Build 26.7.0.124771', 'T4 SonarQube'),
    ('v3.1.0',   'v4.0.6',   'T4 Pylint'),
    ('v9.0.0',   'v9.39.5',  'T4 ESLint'),
]

# --- prose: model names, pipeline description, Table 6 -------------------
PROSE = [
    ("such as Gemini's text-embedding-004",
     'specifically Gemini Embedding 2 (models/gemini-embedding-2)', 1, 'embed prose A'),
    ('the Gemini text-embedding-004 model', 'the Gemini Embedding 2 model', 1, 'embed prose B'),
    ("powered by Gemini's text-embedding-004", 'powered by Gemini Embedding 2', 1, 'embed prose C'),
    ('Gemini text-embedding-004, Supabase pgvector',
     'Gemini Embedding 2, Supabase pgvector', 1, 'T6 embed'),
    ('via the Gemini 1.5 Flash model', 'via the Gemini 3.6 Flash model', 1, 'LLM prose'),
    # extraction is PyMuPDF; LangChain document loaders are not used.
    # A third "document loaders" mention in the Ch.2 literature review is a
    # general statement about RAG systems, not this build, and is left alone.
    ("LangChain's document loaders to process digitized CCSICT theses",
     'PyMuPDF to extract text directly from digitized CCSICT theses', 2, 'document loaders'),
    ("LangChain's 'RetrievalQA' chains will be engineered",
     'A LangChain Expression Language (LCEL) prompt-to-model chain will be engineered',
     1, 'RetrievalQA #1'),
    ("utilizing LangChain's RetrievalQA",
     'utilizing a LangChain Expression Language prompt-to-model chain', 1, 'RetrievalQA #2'),
    ("a context reordering algorithm, such as LangChain's LongContextReorder",
     "a context reordering algorithm re-implementing LangChain's LongContextReorder",
     1, 'LongContextReorder'),
    ('React v19.2.5, Vite v8.0.8, FastAPI v0.135.3',
     'React v19.2.8, Vite v8.1.5, FastAPI v0.139.2', 1, 'T6 Obj3 versions'),
    ('Empirical performance data on Faithfulness and Context Precision',
     'Empirical performance data on Answer Correctness (the paired baseline-versus-RAG '
     'comparison metric), reported alongside Faithfulness and Context Precision as '
     'RAG-only diagnostics', 1, 'T6 Obj2 metrics'),
]


def build(verbose=True):
    xml = D.read_xml(SRC)
    for old, new, label in CELLS:
        xml, _ = D.replace_cell(xml, old, new, expect=1, label=label)
        if verbose: print(f'  cell   {label:26s} {old} -> {new}')
    xml = D.replace_cell_nth(xml, 'text-embedding-004', 'Gemini Embedding 2', 0, 'T3 embed name')
    xml = D.replace_cell_nth(xml, 'text-embedding-004',
                             'models/gemini-embedding-2 (768 dimensions)', 0, 'T3 embed id')
    if verbose: print(f'  cell   {"T3 embedding model":26s} text-embedding-004 -> Gemini Embedding 2')
    for old, new, n, label in PROSE:
        xml = D.replace_runs(xml, old, new, expect=n, label=label)
        if verbose: print(f'  prose  {label}')
    return xml


if __name__ == '__main__':
    xml = build()
    D.write_xml(SRC, DST, xml)
    print(f'\nwrote {DST}')
