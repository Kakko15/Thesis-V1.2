"""Retrieval quality across chunk sizes, for the 800-token claim.

The paper calls 800 tokens "empirically optimized" (paper/build_corrections.py).
Nothing in the repository measured it, so this harness does: it re-chunks the
released twelve-thesis corpus at a range of sizes, embeds each variant with the
same model the application uses, and scores the golden queries whose answer is
known to sit in one named thesis.

Deliberately offline. It reads the corpus PDFs and the golden dataset from
disk, holds every variant index in memory, and writes a JSON result file. It
never touches Supabase, so the frozen production index is not at risk and the
run can be repeated without a migration.

The metric is retrieval, not generation: whether the passages handed to the
model come from the thesis that actually answers the question. Generation
quality is Objective 2's harness (`run_comparison.py`) and is not re-run here,
because chunk size can only reach an answer through what retrieval selected.

    python -m evaluation.chunk_size_sweep --dry-run   # chunk counts, no API
    python -m evaluation.chunk_size_sweep             # full sweep

Requires the same `.env` as the application (GEMINI_API_KEY) plus the corpus at
evaluation/corpus/private/, which is PI-08 controlled and gitignored.
"""

import argparse
import hashlib
import json
import time
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import settings
from services.chunker import TOKENIZER_ENCODING, _TOKEN_SEPARATORS, count_tokens
from services.document_processor import extract_pdf_document, tesserocr
from services.embedder import embed_texts

CORPUS_DIR = Path(__file__).parent / 'corpus' / 'private'
MANIFEST = CORPUS_DIR / 'corpus_manifest.working.json'
GOLDEN = Path(__file__).parent / 'golden_dataset.json'
RESULTS = Path(__file__).parent / 'results'

# The production size sits in the middle, with two steps either side. The step
# is 200 tokens because the splitter packs to its limit: a smaller step moves
# most boundaries by less than one sentence and produces variants that differ
# only in rounding.
CHUNK_SIZES = [400, 600, 800, 1000, 1200]

# Overlap is held at the production 100 tokens across every variant. Scaling it
# with the size would confound the two parameters, and the question on the
# table is the size alone.
OVERLAP = 100

# The application's own retrieval settings, so the sweep scores the pipeline as
# deployed rather than a tuned-for-the-experiment variant of it.
TOP_K = settings.retrieval_match_count
THRESHOLD = settings.retrieval_threshold


def load_corpus() -> list[dict]:
    """Extracted text for every released thesis, keyed by its record id."""
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    papers = []
    for record in manifest['papers']:
        pdf = CORPUS_DIR / f"{record['record_id']}.pdf"
        if not pdf.exists():
            raise FileNotFoundError(f'Corpus PDF missing: {pdf.name}')
        document = extract_pdf_document(pdf.read_bytes())
        papers.append({
            'record_id': record['record_id'],
            'title': record['title'],
            'text': document.text,
            'tokens': count_tokens(document.text),
        })
    return papers


def load_queries(papers: list[dict]) -> list[dict]:
    """Golden queries whose answer is known to sit in one corpus thesis.

    Only the `present` stratum can score retrieval: an `absent_topic` query has
    no correct passage to rank, and a system that returns nothing for it is
    behaving correctly. Those queries test refusal, which chunk size does not
    govern, so scoring them here would measure the wrong thing.

    The dataset names its source thesis by title. Matching is on a normalized
    prefix because the dataset writes the title with its author list appended.
    """
    dataset = json.loads(GOLDEN.read_text(encoding='utf-8'))
    by_title = {paper['title'].lower(): paper['record_id'] for paper in papers}
    queries = []
    for query in dataset['queries']:
        if query.get('corpus_coverage') != 'present':
            continue
        source = (query.get('source_thesis') or '').lower()
        record_id = next(
            (rid for title, rid in by_title.items() if source.startswith(title[:40])),
            None,
        )
        if record_id:
            queries.append({
                'id': query['id'],
                'question': query['question'],
                'expected': record_id,
            })
    return queries


def build_variant(papers: list[dict], size: int) -> list[dict]:
    """Chunk every thesis at one size, keeping the owning record id."""
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name=TOKENIZER_ENCODING,
        chunk_size=size,
        chunk_overlap=OVERLAP,
        separators=_TOKEN_SEPARATORS,
        add_start_index=False,
        allowed_special=set(),
        disallowed_special=(),
    )
    chunks = []
    for paper in papers:
        for text in splitter.split_text(paper['text']):
            if text.strip():
                chunks.append({'record_id': paper['record_id'], 'content': text})
    return chunks


# The free embedding tier allows 100 requests per minute and counts one per
# text, not one per batch, so a 1,870-chunk sweep is quota-bound rather than
# compute-bound: it cannot finish in under ~20 minutes however it is written.
# Pace under the ceiling rather than retrying into it, and cache every vector
# so a run interrupted at chunk 1,200 resumes there instead of paying again.
_REQUESTS_PER_MINUTE = 90
_SLICE = 15
_CACHE = Path(__file__).resolve().parents[2] / 'tmp' / 'chunk_sweep_embeddings.jsonl'


def _cache_key(text: str) -> str:
    seed = f'{settings.gemini_embed_model}:{settings.embedding_dimensions}:{text}'
    return hashlib.sha256(seed.encode('utf-8')).hexdigest()


def load_cache() -> dict[str, list[float]]:
    if not _CACHE.exists():
        return {}
    cached = {}
    for line in _CACHE.read_text(encoding='utf-8').splitlines():
        if line.strip():
            record = json.loads(line)
            cached[record['key']] = record['vector']
    return cached


class QuotaExhausted(RuntimeError):
    """Raised when a variant needs vectors the cache does not hold."""


def embed_cached(texts: list[str], cache: dict[str, list[float]], label: str,
                 cached_only: bool = False) -> list[list[float]]:
    """Embed `texts`, reusing anything already on disk and pacing the rest."""
    missing = [text for text in texts if _cache_key(text) not in cache]
    if missing and cached_only:
        raise QuotaExhausted(f'{label}: {len(missing):,} of {len(texts):,} vectors not cached')
    if missing:
        _CACHE.parent.mkdir(parents=True, exist_ok=True)
        interval = 60.0 / _REQUESTS_PER_MINUTE
        with _CACHE.open('a', encoding='utf-8') as handle:
            for start in range(0, len(missing), _SLICE):
                batch = missing[start : start + _SLICE]
                began = time.monotonic()
                vectors = embed_texts(batch)
                for text, vector in zip(batch, vectors):
                    key = _cache_key(text)
                    cache[key] = vector
                    handle.write(json.dumps({'key': key, 'vector': vector}) + '\n')
                handle.flush()
                done = start + len(batch)
                print(f'  {label}: embedded {done}/{len(missing)}', flush=True)
                pause = (len(batch) * interval) - (time.monotonic() - began)
                if pause > 0 and done < len(missing):
                    time.sleep(pause)
    return [cache[_cache_key(text)] for text in texts]


def cosine(left: list[float], left_norm: float, right: list[float], right_norm: float) -> float:
    if not left_norm or not right_norm:
        return 0.0
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)


def norm_of(vector: list[float]) -> float:
    return sum(value * value for value in vector) ** 0.5


def score_variant(chunks: list[dict], vectors: list[list[float]],
                  queries: list[dict], query_vectors: dict[int, list[float]]) -> dict:
    """Hit rate and reciprocal rank for one chunk-size variant.

    `hit_at_1` is the share of queries whose closest passage in the whole
    corpus belongs to the thesis that answers it; `hit_at_k` allows the answer
    anywhere in the block set the pipeline actually sends. MRR sits between
    them and is the figure to compare on, because it separates two variants
    that both find the thesis but rank it differently.
    """
    chunk_norms = [norm_of(vector) for vector in vectors]
    hit_1 = hit_k = 0
    reciprocal_total = 0.0
    top_similarities = []
    for query in queries:
        query_vector = query_vectors[query['id']]
        query_norm = norm_of(query_vector)
        scored = [
            (cosine(query_vector, query_norm, vector, chunk_norms[index]), index)
            for index, vector in enumerate(vectors)
        ]
        scored.sort(reverse=True)
        retrieved = [(score, index) for score, index in scored[:TOP_K] if score >= THRESHOLD]
        if not retrieved:
            continue
        top_similarities.append(retrieved[0][0])
        owners = [chunks[index]['record_id'] for _, index in retrieved]
        if owners[0] == query['expected']:
            hit_1 += 1
        if query['expected'] in owners:
            hit_k += 1
            reciprocal_total += 1.0 / (owners.index(query['expected']) + 1)
    total = len(queries)
    return {
        'chunks': len(chunks),
        'hit_at_1': round(hit_1 / total * 100, 2) if total else 0.0,
        f'hit_at_{TOP_K}': round(hit_k / total * 100, 2) if total else 0.0,
        'mrr': round(reciprocal_total / total, 4) if total else 0.0,
        'mean_top_similarity': round(sum(top_similarities) / len(top_similarities), 4)
        if top_similarities else 0.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true',
                        help='Report chunk counts per size without calling the embedding API.')
    parser.add_argument('--cached-only', action='store_true',
                        help='Score only the sizes whose vectors are already cached. Use after a '
                             'run stopped on the daily embedding quota, to write the result file '
                             'for what did complete without spending more of it.')
    args = parser.parse_args()

    print(f'Corpus: {CORPUS_DIR}')
    papers = load_corpus()
    print(f'Extracted {len(papers)} theses, '
          f'{sum(paper["tokens"] for paper in papers):,} tokens total\n')

    variants = {size: build_variant(papers, size) for size in CHUNK_SIZES}
    print(f'{"size":>6}  {"chunks":>7}  {"mean tokens/chunk":>18}')
    for size, chunks in variants.items():
        mean_tokens = sum(count_tokens(c['content']) for c in chunks) / len(chunks)
        print(f'{size:>6}  {len(chunks):>7}  {mean_tokens:>18.1f}')
    embeddings_needed = sum(len(chunks) for chunks in variants.values())
    print(f'\nEmbeddings required: {embeddings_needed:,} chunks + queries')

    if args.dry_run:
        print('\nDry run: no embedding calls made.')
        return

    queries = load_queries(papers)
    print(f'Scoring {len(queries)} golden queries with a named source thesis.\n')

    cache = load_cache()
    print(f'Embedding cache holds {len(cache):,} vectors.\n')

    question_vectors = embed_cached([q['question'] for q in queries], cache, 'queries',
                                    args.cached_only)
    query_vectors = {q['id']: vector for q, vector in zip(queries, question_vectors)}

    results = {}
    skipped = {}
    for size, chunks in variants.items():
        started = time.monotonic()
        try:
            vectors = embed_cached([chunk['content'] for chunk in chunks], cache,
                                   f'size {size}', args.cached_only)
        except QuotaExhausted as error:
            skipped[size] = str(error)
            print(f'{size:>6}  skipped ({error})', flush=True)
            continue
        results[size] = score_variant(chunks, vectors, queries, query_vectors)
        results[size]['embed_seconds'] = round(time.monotonic() - started, 1)
        print(f'{size:>6}  {json.dumps(results[size])}', flush=True)

    RESULTS.mkdir(exist_ok=True)
    stamp = time.strftime('%Y-%m-%d')
    out = RESULTS / f'chunk_size_sweep_{stamp}.json'
    out.write_text(json.dumps({
        'generated_on': stamp,
        'corpus_papers': len(papers),
        'queries_scored': len(queries),
        'overlap_tokens': OVERLAP,
        'top_k': TOP_K,
        'retrieval_threshold': THRESHOLD,
        'embedding_model': settings.gemini_embed_model,
        'embedding_dimensions': settings.embedding_dimensions,
        # Recorded because a run without OCR silently drops the corpus's
        # scanned pages, which lowers every variant's hit rate together:
        # the ranking survives, the absolute figures are a floor.
        'ocr_available': tesserocr is not None,
        'results': results,
        'skipped': skipped,
    }, indent=2), encoding='utf-8')
    print(f'\nWrote {out}')


if __name__ == '__main__':
    main()
