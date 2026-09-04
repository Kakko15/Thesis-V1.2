"""RAG chat endpoint — Generation Phase (thesis paper, Section 3.2.3, Phase 3).

Enforces:
  * Minimum cosine-similarity threshold: below it, the system explicitly
    reports that no relevant thesis was found instead of hallucinating.
  * Query-time 85% duplication guard: redundant topics are flagged with the
    exact similarity percentage and an AI-generated summary of the match.
  * Indirect access model: sources are citation metadata only.
  * Retrieval-assistant-only behavior: refuses to write thesis content and
    resists prompt injection (OWASP LLM Top 10).
"""
# pylint: disable=too-many-lines

import asyncio
import logging
import re
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from langchain_google_genai import ChatGoogleGenerativeAI

from config import settings
from dependencies.auth import get_optional_user, resolve_effective_department, sb
from models import ChatRequest, ChatResponse, DuplicationAlert
from routers.openapi_responses import errors
from services.activity import log_activity
from services.citations import (
    enforce_citation_coverage,
    filter_cited_sources,
    normalize_citation_markers,
    validate_citations,
)
from services.embedder import embed_text
from services import gemini_pool
from services import chat_notices, guest_budget, prompts
from services.chat_notices import (
    CAPACITY_MESSAGE,
    capacity_limit_is_active as _capacity_limit_is_active,
    is_capacity_error as _is_capacity_error,
    is_stored_non_answer as _is_stored_non_answer,
    mark_capacity_limited as _mark_capacity_limited,
)
from services.guards import (
    REFUSAL_MESSAGE,
    fallback_standalone_question,
    is_ambiguous_followup,
    prohibited_reason,
)
from services.llm_output import TruncatedGeneration, coerce_text, is_truncated
from services.observability import safe_trace
from services.question_types import AGGREGATE, classify_question
from services.rate_limiting import ip_rate_limit_key, limiter
from services.retriever import (
    _author_name_matches,
    check_topic_duplication,
    find_papers_by_author,
    find_papers_by_ids,
    find_papers_by_title,
    find_papers_by_title_fragment,
    get_paper_overview_context,
    list_archive_papers,
    search_chunks,
    split_author_names,
)
from services.turnstile import ensure_guest_chat_verification

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/chat', tags=['chat'])

# Guests resolve to None; authenticated callers get an opaque Supabase record.
OptionalUser = Annotated[Any, Depends(get_optional_user)]

llm = ChatGoogleGenerativeAI(
    model=settings.gemini_chat_model,
    google_api_key=settings.gemini_api_key,
    timeout=settings.gemini_timeout_seconds,
    max_retries=settings.gemini_max_retries,
    max_output_tokens=settings.gemini_max_output_tokens,
    thinking_level=settings.gemini_thinking_level,
)

_GREETINGS = {
    'hi', 'hello', 'hey', 'hi there', 'hello there', 'hey there',
    'good morning', 'good afternoon', 'good evening',
}
_IDENTITY_QUESTIONS = {
    'who are you', 'what are you', 'who is iskai', 'what is iskai',
    'tell me about yourself',
}
# Capability questions get their own answer: the greeting says who IskAI is,
# not what to ask it. Exact normalized phrases only, like the sets above, so
# the guard matrix and real research questions can never be intercepted.
_CAPABILITY_QUESTIONS = {
    'what can you do', 'what do you do', 'what can you help me with',
    'what can you help with', 'how do i use this', 'how do you work',
    'how does this work', 'what should i ask', 'what should i ask you', 'help',
}
# Thanks and goodbyes stay separate so the response fits the user's intent.
# Without these sets they run semantic retrieval and usually earn a no-evidence
# result for ordinary conversation.
_THANKS = {
    'thanks', 'thank you', 'thank you so much', 'thanks a lot', 'thank you very much',
    'many thanks', 'ty', 'ok thanks', 'okay thanks', 'ok thank you', 'okay thank you',
    'got it thanks',
}
_FAREWELLS = {
    'bye', 'goodbye', 'good bye', 'see you', 'thats all', 'that s all',
    'that is all', 'thats all for now', 'that s all for now',
}
_MODEL_QUESTIONS = {
    'what model are you', 'which model are you', 'what ai model are you',
    'which ai model are you', 'what model do you use', 'which model do you use',
    'what ai model do you use', 'which ai model do you use',
}
# Provenance questions. Kept out of `_IDENTITY_QUESTIONS` because the greeting
# is not an answer to them, and split in two because the two forms are not
# equally clear about what "this" refers to.
_ORIGIN_VERB = r'(?:developed|made|created|built|designed|programmed|coded|wrote)'
# Unambiguously about IskAI itself, so it needs no conversational context.
_SELF_ORIGIN_QUESTION = re.compile(
    rf'who\s+{_ORIGIN_VERB}\s+(?:you|iskai|this\s+(?:ai|assistant|chatbot|bot))',
    re.IGNORECASE,
)
# The same question aimed at "this system". Inside a conversation about an
# archived manuscript this means *that manuscript's* system and must stay a
# retrieval question, so `_chat_impl` answers it as provenance only when the
# conversation holds no archived source for "this" to refer to.
_AMBIGUOUS_ORIGIN_QUESTION = re.compile(
    rf'who\s+{_ORIGIN_VERB}\s+(?:this|the)\s+'
    r'(?:system|app|application|website|site|platform|project|tool|program|software)',
    re.IGNORECASE,
)
# A thesis named by its opening words rather than in full or in quotes.
# Only the reference itself is captured: anything qualifying it ("what about
# the *objectives of* ...") stays in the fragment, fails the title match in
# `find_papers_by_title_fragment`, and correctly falls through to retrieval.
_LOOSE_TITLE_REFERENCE = re.compile(
    r'\s*(?:(?:and|so|ok|okay|but)\s+)?'
    r'(?:what|how)\s+about\s+(.{6,300}?)\s*[?.!]*\s*'
    r'|\s*tell\s+me(?:\s+more)?\s+about\s+(.{6,300}?)\s*[?.!]*\s*',
    re.IGNORECASE,
)
_GREETING_ADDRESSEES = {
    'dear', 'friend', 'my friend', 'iskai', 'dear iskai',
}
_ARCHIVE_INVENTORY_LIMIT = 10
_NUMBERED_THESIS_REFERENCE = re.compile(
    r'^\s*(?:(?:tell me(?: more)?|what|explain|summarize|describe)(?:\s+about)?\s+)?'
    r'(?:the\s+)?(?:(?:thesis|study|paper|title|item)\s+)?'
    r'(?:number|no\.?|#)\s*(\d+)'
    r'(?:\s+(?:thesis|study|paper|title|item|one))?\s*[?.!]*\s*$',
    re.IGNORECASE,
)
_ORDINAL_THESIS_REFERENCE = re.compile(
    r'^\s*(?:(?:tell me(?: more)?|what|explain|summarize|describe)(?:\s+about)?\s+)?'
    r'(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)'
    r'(?:\s+(?:thesis|study|paper|title|item|one))?\s*[?.!]*\s*$',
    re.IGNORECASE,
)
_ORDINAL_POSITIONS = {
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
    'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
}
# The same reference embedded in a longer question: "what are the objectives
# of number 2", "the methodology of the second thesis". The whole-question
# forms above run first; these run when they fail. Before this existed, such a
# question fell to the generic follow-up branch, which pinned the FIRST prior
# source and left "number 2" in the wording -- so the 2026-09-04 transcript
# answered about thesis [1] and read "number 2" as its second objective.
_THESIS_NOUN = r'(?:thesis|theses|study|paper|title|item|source|result|entry|one)'
_INLINE_NUMBERED_REFERENCE = re.compile(
    r'(?<![\w#])(?:(?:the\s+)?' + _THESIS_NOUN + r'\s+)?'
    r'(?:number|no\.?|#)\s*(\d{1,2})\b(?:\s+' + _THESIS_NOUN + r'\b)?',
    re.IGNORECASE,
)
_INLINE_ORDINAL_REFERENCE = re.compile(
    r'\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+'
    + _THESIS_NOUN + r'\b',
    re.IGNORECASE,
)
# A count noun directly before "number N" makes it a position inside a
# manuscript, not a position in the prior answer: "objective number 2".
_IN_DOCUMENT_COUNTABLE = re.compile(
    r'\b(?:objective|chapter|section|figure|table|page|question|hypothesis|hypotheses'
    r'|phase|step|goal|aim|rq|so|finding|recommendation)\s*$',
    re.IGNORECASE,
)


def _normalize_short_query(question: str) -> str:
    return re.sub(r'[^a-z0-9 ]+', ' ', question.lower()).strip()


def _is_simple_conversation(question: str) -> bool:
    """Handle greetings and identity questions without an expensive RAG call."""
    normalized = re.sub(r'\s+', ' ', _normalize_short_query(question))
    if len(normalized) > 80:
        return False
    if normalized in _GREETINGS or normalized in _IDENTITY_QUESTIONS:
        return True
    for greeting in _GREETINGS:
        if normalized.startswith(f'{greeting} '):
            remainder = normalized[len(greeting) + 1:]
            # A single trailing word is normally a name or mistyped addressee
            # ("hello iskai", "hello sdad"), not a research question. Longer
            # wording still falls through to RAG so "hello machine learning"
            # cannot silently lose a topic query.
            return (
                remainder in _IDENTITY_QUESTIONS
                or remainder in _GREETING_ADDRESSEES
                or len(remainder.split()) == 1
            )
    return False


def _is_identity_question(question: str) -> bool:
    """Whether a local conversational turn asks what IskAI is."""
    normalized = re.sub(r'\s+', ' ', _normalize_short_query(question))
    if normalized in _IDENTITY_QUESTIONS:
        return True
    return any(
        normalized == f'{greeting} {identity}'
        for greeting in _GREETINGS
        for identity in _IDENTITY_QUESTIONS
    )


def _is_unsupported_single_token_query(
    question: str,
    context: str,
    sources: list[dict],
) -> bool:
    """Reject opaque one-word prompts that embeddings matched by accident.

    Real one-word topics remain valid when their normalized text occurs in the
    selected evidence or source metadata. Short acronyms such as AI and OCR are
    left to retrieval because compact substring matching is too noisy for them.
    """
    tokens = re.findall(r'[a-z0-9]+', (question or '').lower())
    if len(tokens) != 1 or len(tokens[0]) < 4:
        return False
    token = tokens[0]
    evidence_text = ' '.join([
        context,
        *(
            str(source.get(field) or '')
            for source in sources
            for field in ('title', 'authors', 'track', 'section_title')
        ),
    ]).lower()
    compact_evidence = re.sub(r'[^a-z0-9]+', '', evidence_text)
    return token not in compact_evidence


def _is_capability_question(question: str) -> bool:
    """Exact-phrase capability/help questions, with an optional greeting prefix."""
    normalized = re.sub(r'\s+', ' ', _normalize_short_query(question))
    if len(normalized) > 80:
        return False
    if normalized in _CAPABILITY_QUESTIONS:
        return True
    for greeting in _GREETINGS:
        if normalized.startswith(f'{greeting} '):
            return normalized[len(greeting) + 1:] in _CAPABILITY_QUESTIONS
    return False


def _is_courtesy_message(question: str) -> bool:
    """Exact-phrase thanks/goodbyes. Length-capped so 'thanks for the summary
    of the attendance thesis, now compare it with...' stays a research turn."""
    normalized = re.sub(r'\s+', ' ', _normalize_short_query(question))
    return len(normalized) <= 40 and normalized in (_THANKS | _FAREWELLS)


def _is_farewell_message(question: str) -> bool:
    normalized = re.sub(r'\s+', ' ', _normalize_short_query(question))
    return len(normalized) <= 40 and normalized in _FAREWELLS


def _is_model_question(question: str) -> bool:
    normalized = re.sub(r'\s+', ' ', _normalize_short_query(question))
    return normalized in _MODEL_QUESTIONS


def _normalized_short_question(question: str) -> str:
    return re.sub(r'\s+', ' ', _normalize_short_query(question or '')).strip()


def _is_system_origin_question(question: str) -> bool:
    """A self-directed question about who built IskAI itself."""
    return bool(_SELF_ORIGIN_QUESTION.fullmatch(_normalized_short_question(question)))


def _is_ambiguous_system_origin_question(question: str) -> bool:
    """`who developed this system` — IskAI, or a system described in a thesis?"""
    return bool(_AMBIGUOUS_ORIGIN_QUESTION.fullmatch(_normalized_short_question(question)))


def _origin_response() -> str:
    # Defined in chat_notices for the same reason the greeting is: a reworded
    # copy here would stop being recognized as a notice and start being replayed
    # to the model as conversational context.
    return chat_notices.SYSTEM_ORIGIN_MESSAGE


def _model_response() -> str:
    return (
        f'IskAI uses {settings.gemini_chat_model} to generate citation-backed answers and '
        'Gemini Embedding to find relevant thesis evidence. It answers only from the '
        'indexed CCSICT thesis archive.'
    )


def _conversation_response(question: str = '', prior_replies: list[str] | None = None) -> str:
    # Defined in chat_notices so the notice classifier and this message cannot
    # drift apart; a reworded greeting would otherwise stop being recognized as
    # a notice and start being replayed to the model as conversational context.
    if _is_identity_question(question):
        return chat_notices.IDENTITY_MESSAGE
    return chat_notices.varied_message(
        chat_notices.CONVERSATION_MESSAGES,
        prior_replies or [],
    )


def _is_archive_inventory_question(question: str, prior_questions: list[str] | None = None) -> bool:
    """Identify requests about live archive contents rather than manuscript text."""
    normalized = re.sub(r'[^a-z0-9 ]+', ' ', (question or '').lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    if not normalized:
        return False
    direct_patterns = (
        r'\bhow many\b.*\b(?:thesis|theses|papers|studies)\b',
        r'\b(?:list|show|which|what)\b.*\b(?:thesis|theses|papers|studies)\b.*'
        r'\b(?:archive|available|here|indexed|system)\b',
        r'\b(?:list|show|which|what)\b.*\b(?:available|indexed|archive)\b.*\b(?:thesis|theses|papers|studies)\b',
        r'\b(?:any|are there|is there)\b.*\b(?:thesis|theses|papers|studies)\b.*\b(?:other|others|more|than)\b',
        r'\b(?:any|are there|is there)\b.*\b(?:other|others|more)\b.*\b(?:thesis|theses|papers|studies)\b',
        r'\b(?:thesis|theses|papers|studies)\b.*\bother than\b',
    )
    if any(re.search(pattern, normalized) for pattern in direct_patterns):
        return True
    recent_inventory_question = any(
        _is_archive_inventory_question(previous)
        for previous in (prior_questions or [])[-3:]
    )
    if recent_inventory_question and _is_archive_count_confirmation(normalized):
        return True
    # After an archive count, “what are those?” means “list the counted theses”,
    # not “retrieve terms from the last cited manuscript”. Include the common
    # clarification phrasing users use after the assistant answered the wrong scope.
    if recent_inventory_question and (
        re.search(r'\b(?:what are|name|named|list|show|which|tell me)\b', normalized)
        and re.search(r'\b(?:those|them|these)\b', normalized)
        or re.search(
            r'\b(?:i am|im|i m)\s+(?:talking|referring)\s+about\s+'
            r'(?:the\s+)?(?:\d+|one|two|three|four|five)\s+'
            r'(?:thesis|theses|paper|papers|study|studies)\b',
            normalized,
        )
    ):
        return True
    if normalized in {'any others', 'are there others', 'is that all', 'only one', 'one only'}:
        return recent_inventory_question
    return False


def _is_archive_count_confirmation(normalized_question: str) -> bool:
    """Recognize short confirmations of a previously reported archive count."""
    return bool(re.fullmatch(
        r'(?:only|just)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)'
        r'(?:\s+(?:thesis|theses|paper|papers|study|studies))?(?:\s+for\s+now)?',
        normalized_question,
    ))


def _is_archive_count_question(question: str, prior_questions: list[str] | None = None) -> bool:
    normalized = re.sub(r'[^a-z0-9 ]+', ' ', (question or '').lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    direct_count_question = bool(
        re.search(r'\bhow many\b', normalized)
        or re.search(r'\b(?:count|number) of\b.*\b(?:thesis|theses|papers|studies)\b', normalized)
    )
    if direct_count_question:
        return True
    recent_inventory_question = any(
        _is_archive_inventory_question(previous)
        for previous in (prior_questions or [])[-3:]
    )
    return recent_inventory_question and _is_archive_count_confirmation(normalized)


def _archive_inventory_response(
    department: str,
    total: int,
    sources: list[dict],
    *,
    count_only: bool = False,
) -> str:
    """Describe the authoritative ready-paper inventory without an LLM."""
    if not total:
        return f'The {department} archive currently has no indexed theses.'
    noun = 'thesis' if total == 1 else 'theses'
    count_text = f'The {department} archive currently has **{total} indexed {noun}**.'
    if count_only:
        return f'{count_text} This count comes from the live indexed archive.'

    lines = [f'{count_text[:-1]}:']
    for index, source in enumerate(sources, start=1):
        details = [str(value) for value in (source.get('year'), source.get('track')) if value]
        detail_text = f" ({' · '.join(details)})" if details else ''
        lines.append(
            f'{index}. **{source.get("title", "Untitled thesis")}** by '
            f'{source.get("authors", "Unknown authors")}{detail_text} [{index}]'
        )
    answer = '\n'.join(lines)
    if total > len(sources):
        answer += (
            f'\n\nShowing the first **{len(sources)} of {total}** titles alphabetically. '
            'Use the archive filters or ask by topic, title, author, year, or category to narrow the list.'
        )
    answer += (
        '\n\nThis count comes from the live indexed archive, not from claims inside a thesis document.'
    )
    return answer


def _extract_author_name(question: str) -> str | None:
    """Extract a plausible person name from direct and follow-up author questions."""
    match = re.fullmatch(
        r"\s*(?:who\s+is|(?:and\s+)?what\s+about)\s+("
        r"[A-Za-z][A-Za-z'’-]*"
        r"(?:\s+(?:[A-Za-z]\.?|[A-Za-z][A-Za-z'’-]*)){1,5}"
        r")\s*[?.!]*\s*",
        question,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    name = re.sub(r'\s+', ' ', match.group(1)).strip()
    if name.lower().split()[0] in {'the', 'this', 'that', 'your', 'our'}:
        return None
    return ' '.join(part.capitalize() for part in name.split())


def _is_explicit_author_identity_question(question: str) -> bool:
    """A direct `who is` question should return a deterministic not-found result."""
    return bool(re.match(r'^\s*who\s+is\b', question or '', flags=re.IGNORECASE))


def _format_names(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f'{names[0]} and {names[1]}'
    return ', '.join(names[:-1]) + f', and {names[-1]}'


def _author_lookup_response(name: str, sources: list[dict]) -> str:
    if not sources:
        return (
            f'I could not verify {name} as an author in the selected ISU thesis archive. '
            'Try the complete name or ask for a specific thesis title.'
        )
    if len(sources) == 1:
        source = sources[0]
        details = [str(value) for value in (source.get('year'), source.get('track')) if value]
        detail_text = f" ({' · '.join(details)})" if details else ''
        archived_authors = split_author_names(source.get('authors', ''))
        matched_author = next(
            (author for author in archived_authors if _author_name_matches(name, author)),
            name,
        )
        coauthors = [author for author in archived_authors if author != matched_author]
        relationship = (
            f'is a co-author of “{source.get("title", "Untitled thesis")}” '
            f'with {_format_names(coauthors)}'
            if coauthors
            else f'is an author of “{source.get("title", "Untitled thesis")}”'
        )
        return (
            f'{matched_author} {relationship}{detail_text} [1].'
        )
    entries = []
    for index, source in enumerate(sources, start=1):
        details = [str(value) for value in (source.get('year'), source.get('track')) if value]
        detail_text = f" ({' · '.join(details)})" if details else ''
        entries.append(f'“{source.get("title", "Untitled thesis")}”{detail_text} [{index}]')
    return f'I found archive author matches for {name} in these theses: ' + '; '.join(entries) + '.'


def _looks_like_misdirected_greeting(answer: str) -> bool:
    normalized = re.sub(r'\s+', ' ', answer.lower()).strip()
    return normalized.startswith(('hello', 'hi ', 'hey ')) and any(
        identity in normalized for identity in ("i'm iskai", 'i am iskai', 'iskai here')
    )


def _answer_reports_no_evidence(answer: str) -> bool:
    """Recognize a model's explicit statement that current evidence cannot answer."""
    normalized = re.sub(r'\s+', ' ', answer.lower()).strip()
    return any(phrase in normalized for phrase in (
        'could not verify', 'cannot verify', 'could not find', 'cannot find',
        'no relevant thesis', 'no relevant study', 'no direct answer',
        'does not contain', 'do not contain', "doesn't contain", "don't contain",
        'not enough information',
        'insufficient information', 'unable to answer', 'cannot answer',
        'no information about', 'no evidence about', 'does not provide',
        'do not provide', 'does not discuss', 'do not discuss',
        'does not address', 'do not address', "doesn't address", "don't address",
        'does not mention', 'do not mention', "doesn't mention", "don't mention",
        'unrelated to the question',
        'not addressed in the retrieved', 'not covered by the retrieved',
    ))


def _grounded_retrieval_fallback(sources: list[dict], department: str | None = None) -> str:
    if not sources:
        return get_no_relevant_message(department)
    unique_sources = []
    seen_papers = set()
    for source in sources:
        paper_id = source.get('id')
        if paper_id in seen_papers:
            continue
        seen_papers.add(paper_id)
        unique_sources.append(source)
        if len(unique_sources) == 3:
            break

    closest = []
    for index, source in enumerate(unique_sources, start=1):
        location = source.get('section')
        if not location and source.get('page_start'):
            page_end = source.get('page_end')
            location = (
                f'pages {source["page_start"]}–{page_end}'
                if page_end and page_end != source['page_start']
                else f'page {source["page_start"]}'
            )
        location_text = f' — {location}' if location else ''
        citation_id = source.get('citation_id', index)
        closest.append(
            f'“{source.get("title", "Untitled thesis")}”{location_text} [{citation_id}]'
        )
    # Prefixed with the shared constant so response_kind() stores this as a
    # notice. It keeps its citations and its source cards -- retrieval did
    # succeed -- but it is the system talking about itself, so it must never be
    # replayed to the model as prior conversational context.
    return (
        f'{chat_notices.GROUNDED_FALLBACK_PREFIX} from the retrieved thesis text. '
        f'The closest archived studies are {"; ".join(closest)}. '
        'Try asking about one of these titles.'
    )


def _notice_response(message: str, session_id: str | None = None) -> ChatResponse:
    """A response the system produced about itself: never any sources."""
    return ChatResponse(answer=message, sources=[], session_id=session_id)


def _capacity_response(session_id: str | None = None) -> ChatResponse:
    return _notice_response(CAPACITY_MESSAGE, session_id)


def _guest_budget_response(session_id: str | None = None) -> ChatResponse:
    return _notice_response(guest_budget.GUEST_BUDGET_MESSAGE, session_id)


def _charge_guest_generation(*texts: str) -> guest_budget.BudgetDecision:
    """Estimate and book one guest generation in a single worker-thread hop.

    Both halves are synchronous and CPU- or network-bound (tokenizing the prompt,
    then an increment against the shared store), so they belong off the event
    loop together rather than as two separate awaits.
    """
    return guest_budget.charge(guest_budget.estimate_charge(*texts))


# The four generation prompts live in services/prompts.py, composed from shared
# rule blocks. They were four hand-maintained copies of one rule set and had
# already drifted: the verbatim/IP rule and the refusal rule existed only on the
# grounded path, and both exact-paper prompts had lost the word "untrusted".
get_rag_prompt = prompts.grounded_prompt
get_overview_prompt = prompts.overview_prompt
get_exact_paper_prompt = prompts.exact_paper_prompt
get_exact_papers_prompt = prompts.exact_papers_prompt


def get_no_relevant_message(department: str | None = None) -> str:
    dept_name = department if department else "Isabela State University"
    # The prefix lives in chat_notices so the notice classifier and this message
    # cannot drift apart; a reworded message would otherwise stop being
    # recognized as a notice.
    return (
        f'{chat_notices.NO_RELEVANT_PREFIX} {dept_name} archive for that query. '
        'Try rephrasing with different technical terms, or ask about another topic.'
    )


# Kept as a module-local name; the implementation is now shared with
# routers/duplication.py and routers/upload.py.
_coerce_answer = coerce_text


def _load_chat_history(session_id: str, user_id: str) -> list[dict]:
    owner = sb.table('chat_sessions').select('id') \
        .eq('id', session_id).eq('user_id', user_id).execute()
    if not owner.data:
        raise HTTPException(status_code=404, detail='Session not found')
    # B14: only real answers become conversational context. Filtered in SQL so a
    # session whose recent history is mostly notices still returns five usable
    # exchanges instead of five rows that are then discarded in Python.
    past = sb.table('chat_messages') \
        .select('question, answer, sources') \
        .eq('session_id', session_id) \
        .eq('kind', chat_notices.KIND_ANSWER) \
        .order('created_at', desc=True) \
        .limit(5) \
        .execute()
    return list(reversed(past.data or []))


def _ensure_session_owner(session_id: str, user_id: str, department: str) -> None:
    owner = (
        sb.table('chat_sessions')
        .select('id,department')
        .eq('id', session_id)
        .eq('user_id', user_id)
        .limit(1)
        .execute()
    )
    if not owner.data:
        raise HTTPException(status_code=404, detail='Session not found')
    if owner.data[0].get('department') != department:
        raise HTTPException(
            status_code=409,
            detail='This conversation belongs to a different department. Start a new conversation.',
        )


def _truncate_session_from_turn(
    session_id: str,
    user_id: str,
    department: str,
    turn: int,
) -> None:
    """Delete the edited saved turn and every later branch turn."""
    _ensure_session_owner(session_id, user_id, department)
    rows = (
        sb.table('chat_messages')
        .select('id')
        .eq('session_id', session_id)
        .order('created_at', desc=False)
        .execute()
    ).data or []
    stale_ids = [row['id'] for row in rows[turn:] if row.get('id')]
    if stale_ids:
        sb.table('chat_messages').delete().in_('id', stale_ids).execute()


def _persist_chat_exchange(req: ChatRequest, response: ChatResponse, user, department: str) -> str:
    alert = response.duplication_alert.model_dump() if response.duplication_alert else None
    result = sb.rpc('save_chat_exchange', {
        'p_user_id': user.id,
        'p_session_id': response.session_id,
        'p_title': req.question[:40] + ('...' if len(req.question) > 40 else ''),
        'p_question': req.question,
        'p_answer': response.answer,
        'p_sources': response.sources,
        'p_duplication_alert': alert,
        'p_department': department,
        # B14: classified here, at the source, rather than by matching the stored
        # text later. The user still sees the notice in their transcript; the
        # history loader and the model never do.
        'p_kind': chat_notices.response_kind(response),
    }).execute()
    return str(result.data)


def _format_chat_history(messages: list[dict]) -> str:
    """Render prior turns as wording context, escaped.

    Every turn is escaped before it reaches the prompt. This is the one place
    a *client* controls text landing above the evidence block: guest history
    arrives in the request body and is filtered only by `prohibited_reason`,
    whose injection regex looks for "ignore previous instructions" phrasing
    and matches nothing XML-shaped. Unescaped, one guest turn could close the
    fence and open a forged one, so the model would see two
    <retrieved_context> blocks with the fabricated one first. Any marker it
    reused would be in range, so `validate_citations` would pass a fabricated
    claim carrying a real-looking citation.
    """
    history = ''
    for msg in messages:
        question = prompts.fence_history(msg['question'])
        history += f"Human: {question}\n"
        if msg.get('answer'):
            clean_answer = re.sub(r'\[\d+\]', '', msg['answer'])
            history += f"AI: {prompts.fence_history(clean_answer)}\n"
        history += '\n'
    return history


def _overview_question_for_source(source: dict) -> str:
    """Create an evidence-only overview intent for a known archived thesis."""
    return (
        'Explain the central research problem, proposed system architecture, technical scope, '
        'intended beneficiaries, and evaluation approach described in the archived thesis titled '
        f'"{source.get("title", "Untitled thesis")}" by {source.get("authors", "its authors")}. '
        'Summarize only details supported by that thesis.'
    )


def _resolve_referenced_thesis(question: str, prior_sources: list[dict]) -> str | None:
    """Resolve common malformed pronouns against a server-verified prior source."""
    if not prior_sources:
        return None
    normalized = re.sub(r'[^a-z0-9 ]+', ' ', (question or '').lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    asks_about_thesis = (
        'thesis' in normalized
        and 'about' in normalized
        and re.search(r'\b(they|their|his|her|this|that|the)\b', normalized)
    ) or bool(re.fullmatch(r'(?:what|tell me)\s+(?:is\s+)?it\s+about', normalized))
    return _overview_question_for_source(prior_sources[0]) if asks_about_thesis else None


def _resolve_numbered_thesis_reference(question: str, prior_sources: list[dict]) -> dict | None:
    """Map a numbered or ordinal follow-up to the prior response's source order."""
    if not prior_sources:
        return None
    match = _NUMBERED_THESIS_REFERENCE.fullmatch(question or '')
    if match:
        position = int(match.group(1))
    else:
        ordinal_match = _ORDINAL_THESIS_REFERENCE.fullmatch(question or '')
        position = _ORDINAL_POSITIONS.get(ordinal_match.group(1).lower()) if ordinal_match else None
    if not position or position > len(prior_sources):
        return None
    return prior_sources[position - 1]


def _resolve_inline_thesis_reference(
    question: str, prior_sources: list[dict],
) -> tuple[dict, str] | None:
    """Find a numbered or ordinal thesis reference inside a longer question.

    Returns the referenced prior source and the question with the reference
    phrase replaced by the thesis title, so "what are the objectives of
    number 2" becomes "what are the objectives of the archived thesis titled
    "..."" and no numeral is left for the model to reinterpret. None when the
    question carries no such reference, the position is out of range, or the
    number counts something inside a manuscript ("objective number 2").
    """
    if not prior_sources:
        return None
    text = question or ''
    position = None
    match = _INLINE_NUMBERED_REFERENCE.search(text)
    if match and not _IN_DOCUMENT_COUNTABLE.search(text[:match.start()].rstrip()):
        position = int(match.group(1))
    else:
        match = _INLINE_ORDINAL_REFERENCE.search(text)
        if match:
            position = _ORDINAL_POSITIONS.get(match.group(1).lower())
    if not match or not position or position > len(prior_sources):
        return None
    source = prior_sources[position - 1]
    title = source.get('title', 'Untitled thesis')
    standalone = f'{text[:match.start()]}the archived thesis titled "{title}"{text[match.end():]}'
    return source, re.sub(r'\s+', ' ', standalone).strip()


def _overview_question_for_sources(sources: list[dict]) -> str:
    """Overview intent for every thesis shown in the previous answer."""
    titles = '; '.join(
        f'"{source.get("title", "Untitled thesis")}"' for source in sources
    )
    return (
        'For each of the archived theses titled ' + titles + ', explain the central research '
        'problem, proposed system, technical scope, and evaluation approach, addressing each '
        'thesis separately under its own title. Summarize only details supported by that thesis.'
    )


def _is_plural_source_followup(question: str, prior_sources: list[dict]) -> bool:
    """Recognize a plural reference to all theses shown in the prior answer."""
    if len(prior_sources) < 2:
        return False
    normalized = re.sub(r'[^a-z0-9 ]+', ' ', (question or '').lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return bool(
        re.search(
            r'\b(?:both|all|these|those|the two|two)\s+'
            r'(?:theses|thesis|papers|paper|studies|study)\b',
            normalized,
        )
        or re.search(r'\b(?:their|them)\b', normalized)
        or re.search(
            r'\b(?:provide|give|show|tell me|what is|summari[sz]e)\s+'
            r'(?:me\s+)?(?:a\s+|the\s+)?(?:summary|summaries)\b',
            normalized,
        )
    )


def _extract_explicit_thesis_title(question: str) -> str | None:
    """Extract a thesis title that the user explicitly quoted."""
    quoted_titles = re.findall(r'["“]([^"”]{8,300})["”]', question or '')
    quoted_titles.extend(re.findall(
        r"(?<![A-Za-z])'([^']{8,300})'(?![A-Za-z])", question or '',
    ))
    thesis_terms = re.compile(r'\b(?:thesis|paper|study|other)\b', re.IGNORECASE)
    quoted = next(
        (title.strip() for title in quoted_titles if thesis_terms.search(question)),
        None,
    )
    if quoted:
        return quoted
    unquoted = re.search(
        r'\b(?:(?:the\s+)?other\s+(?:thesis|paper|study)|'
        r'(?:thesis|paper|study)\s+(?:titled|named))\s*[:\-]?\s*'
        r'(.{8,300}?)(?:\s*[?.!]\s*)?$',
        question or '',
        flags=re.IGNORECASE,
    )
    return unquoted.group(1).strip() if unquoted else None


def _extract_thesis_title_fragment(question: str) -> str | None:
    """Capture what a bare `what about <X>` reference names, without judging it.

    Whether the fragment is a thesis is decided by the archive, not here: the
    caller acts only when it resolves to exactly one ready paper. So this stays
    permissive on purpose, and `what about their methodology` costs one lookup
    that finds nothing rather than being excluded by a word list that would
    also exclude real titles.
    """
    match = _LOOSE_TITLE_REFERENCE.fullmatch(question or '')
    if not match:
        return None
    fragment = (match.group(1) or match.group(2) or '').strip()
    return fragment or None


def _resolve_specific_paper_followup(question: str, source: dict) -> str:
    """Make a referenced-paper follow-up standalone without another AI call."""
    return (
        f'Regarding the archived thesis titled "{source.get("title", "Untitled thesis")}" '
        f'by {source.get("authors", "its authors")}: {question}'
    )


async def _rewrite_followup(
    question: str,
    prior_questions: list[str],
    prior_sources: list[dict] | None = None,
) -> str:
    prompt = prompts.followup_rewrite_prompt(question, prior_questions, prior_sources)
    try:
        rewritten = _coerce_answer(
            await gemini_pool.arun(llm, gemini_pool.CHAT, lambda client: client.ainvoke(prompt))
        ).strip()
        if (
            3 <= len(rewritten) <= 1000
            and '\n' not in rewritten
            and not rewritten.lower().startswith(('answer:', 'response:'))
        ):
            return rewritten
    except Exception as e:
        logger.warning('Follow-up rewrite failed; using fallback (%s)', type(e).__name__)
    return fallback_standalone_question(question, prior_questions)


async def _repair_citations(answer: str, context: str, sources: list[dict]) -> str:
    valid_ids = ', '.join(str(s.get('citation_id', i)) for i, s in enumerate(sources, start=1))
    prompt = prompts.citation_repair_prompt(answer, context, valid_ids)
    async with safe_trace('rag.citation_repair', metadata={
        'source_count': len(sources),
        'answer_length': len(answer),
        'model': settings.gemini_chat_model,
    }):
        result = await gemini_pool.arun(
            llm, gemini_pool.CHAT, lambda client: client.ainvoke(prompt),
        )
        # A severed repair is a failed repair. Returning it would hand the
        # caller a fragment that its own validation may well pass, since the
        # surviving units keep their markers. The caller already treats a raised
        # repair failure as a reason to serve the grounded fallback.
        if is_truncated(result):
            raise TruncatedGeneration('citation repair stopped at the output ceiling')
        return _coerce_answer(result).strip()


def _missing_referenced_papers(
    answer: str,
    sources: list[dict],
    referenced_paper_ids: list[str],
) -> list[str]:
    """Return exact papers that received no citation in a plural answer."""
    cited = {
        source.get('id')
        for source in filter_cited_sources(answer, sources)
        if source.get('id')
    }
    return [paper_id for paper_id in referenced_paper_ids if paper_id not in cited]


async def _repair_multi_paper_coverage(
    answer: str,
    question: str,
    context: str,
    sources: list[dict],
) -> str:
    """Rewrite an incomplete plural answer once using all selected papers."""
    titles = list(dict.fromkeys(
        source.get('title', 'Untitled thesis') for source in sources
    ))
    prompt = prompts.multi_paper_repair_prompt(answer, question, context, titles)
    result = await gemini_pool.arun(
        llm, gemini_pool.CHAT, lambda client: client.ainvoke(prompt),
    )
    # This rewrite replaces the answer wholesale, so a severed one would install
    # a fragment over a complete reply. The caller keeps the original draft when
    # this raises, which is the better of the two available answers.
    if is_truncated(result):
        raise TruncatedGeneration('multi-paper coverage repair stopped at the output ceiling')
    return _coerce_answer(result).strip()


async def _summarize_duplication(alert: dict) -> str:
    """Brief AI summary of the matched archival study (paper, Section 1.3).

    Every field interpolated below comes out of a third-party manuscript, so it
    is escaped and fenced exactly as `search_chunks` and the duplication scanner
    already do. This prompt used to interpolate the abstract and excerpt raw,
    which made it the one place a manuscript containing instruction-shaped text
    could steer output — and the output is the duplication banner faculty read
    when validating topic novelty, which is the worst possible audience for it.
    """
    prompt = prompts.duplication_summary_prompt(
        alert['matched_paper'], alert.get('matched_abstract'), alert.get('matched_excerpt'),
    )
    try:
        return _coerce_answer(
            await gemini_pool.arun(llm, gemini_pool.CHAT, lambda client: client.ainvoke(prompt))
        ).strip()
    except Exception as e:
        logger.exception('Duplication summary generation failed (%s)', type(e).__name__)
        return ''


async def _retrieve_evidence(
    question: str,
    department: str,
    referenced_paper_id: str | list[str] | None,
    is_overview_followup: bool,
    thesis_category: str | None = None,
    per_paper_cap: int | None = None,
):
    """Run the current-evidence retrieval path under one traceable boundary."""
    if isinstance(referenced_paper_id, list):
        results = await asyncio.gather(*(
            asyncio.to_thread(
                get_paper_overview_context,
                paper_id,
                department,
                None if is_overview_followup else question,
            )
            for paper_id in referenced_paper_id
        ))
        context_parts = []
        sources = []
        for context, paper_sources, _similarity in results:
            offset = len(sources)
            # Only renumber source markers at the start of context blocks;
            # bracketed material inside archived text is part of the thesis.
            context_parts.append(re.sub(
                r'(?m)^\[(\d+)\]',
                lambda match, source_offset=offset: (
                    f'[{int(match.group(1)) + source_offset}]'
                ),
                context,
            ))
            sources.extend(
                {**source, 'citation_id': offset + index}
                for index, source in enumerate(paper_sources, start=1)
            )
        return ('\n\n'.join(part for part in context_parts if part), sources, 1.0 if sources else 0.0), None
    if referenced_paper_id:
        # A directly referenced paper is already an explicit scope; the
        # category filter only narrows semantic search.
        result = await asyncio.to_thread(
            get_paper_overview_context,
            referenced_paper_id,
            department,
            None if is_overview_followup else question,
        )
        return result, None

    async with safe_trace('rag.embedding', metadata={
        'department': department,
        'question_length': len(question),
        'model': settings.gemini_embed_model,
    }):
        query_embedding = await asyncio.to_thread(embed_text, question)

    async def check_duplication():
        async with safe_trace('rag.duplication', metadata={
            'department': department,
            'question_length': len(question),
        }):
            return await asyncio.to_thread(
                check_topic_duplication,
                question,
                None,
                query_embedding,
                department,
                thesis_category,
            )

    result, alert = await asyncio.gather(
        asyncio.to_thread(
            search_chunks, question, department, query_embedding, thesis_category,
            per_paper_cap,
        ),
        check_duplication(),
    )
    return result, alert


async def _invoke_generation(prompt_template, generation_input: dict, alert_data: dict | None):
    async def generate():
        # Rebuilt per client so a reserve key composes the same prompt;
        # `prompt_template | llm` is still exactly what runs on the primary.
        return await gemini_pool.arun(
            llm, gemini_pool.CHAT,
            lambda client: (prompt_template | client).ainvoke(generation_input),
        )

    if alert_data:
        result, duplication_summary = await asyncio.gather(
            generate(),
            _summarize_duplication(alert_data),
        )
        return result, duplication_summary
    return await generate(), None


@router.post('', response_model=ChatResponse, responses=errors(401, 502, 503))
@limiter.limit(settings.rate_limit_chat_ip, key_func=ip_rate_limit_key)
@limiter.limit(settings.rate_limit_chat)
async def chat(
    req: ChatRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: OptionalUser,
):
    await ensure_guest_chat_verification(request, user)
    async with safe_trace('rag.chat.total', metadata={
        'question_length': len(req.question),
        'authenticated': bool(user),
        'model': settings.gemini_chat_model,
    }) as run:
        # Resolved once here and threaded through. It reads the profile, and for
        # a superadmin also validates the requested department, so doing it in
        # both this wrapper and `_chat_impl` cost two extra round trips per
        # turn. It stays in a thread like every other Supabase call on this path,
        # and any HTTPException it raises must still surface before retrieval.
        department = (
            await asyncio.to_thread(resolve_effective_department, user, req.department_filter)
            if user
            else None
        )
        response = await _chat_impl(
            req, request, background_tasks, user, resolved_department=department,
        )
        if user:
            try:
                if req.edit_from_turn is not None:
                    if not req.session_id:
                        raise HTTPException(status_code=400, detail='A prompt edit requires a saved session.')
                    await asyncio.to_thread(
                        _truncate_session_from_turn,
                        req.session_id,
                        user.id,
                        department,
                        req.edit_from_turn,
                    )
                session_id = await asyncio.to_thread(
                    _persist_chat_exchange,
                    req,
                    response,
                    user,
                    department,
                )
                response.session_id = session_id
                response.history_saved = True
            except HTTPException:
                raise
            except Exception as error:
                logger.warning('Failed to persist chat history: %s', type(error).__name__)
                response.history_saved = False
        if run:
            run.add_metadata({
                'source_count': len(response.sources),
                'no_relevant_thesis': response.no_relevant_thesis,
                'history_saved': response.history_saved,
                'status': 'completed',
            })
        return response


async def _chat_impl(
    req: ChatRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user,
    evaluation_trace: dict | None = None,
    resolved_department: str | None = None,
) -> ChatResponse:
    """Run the chat pipeline and stamp `ChatResponse.kind` on the way out.

    The pipeline body has ~12 return statements; classifying here once means
    every one of them, the route wrapper, and the evaluation harness (which
    calls this function directly) all see the same classification the
    persistence layer stores in `chat_messages.kind`.
    """
    response = await _chat_impl_unstamped(
        req, request, background_tasks, user, evaluation_trace, resolved_department,
    )
    response.kind = chat_notices.response_kind(response)
    return response


async def _chat_impl_unstamped(
    req: ChatRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user,
    evaluation_trace: dict | None = None,
    resolved_department: str | None = None,
):  # pylint: disable=too-many-return-statements
    # `resolve_effective_department` reads `profiles`, and for a superadmin also
    # validates the request against `departments`. The route wrapper needs the
    # same value to persist the exchange, so it resolved it a second time --
    # two extra round trips per authenticated turn, four for a superadmin.
    # Optional rather than required so the evaluation harness, which calls this
    # directly, keeps working unchanged.
    effective_department = resolved_department or await asyncio.to_thread(
        resolve_effective_department, user, req.department_filter,
    )
    if req.session_id:
        if not user:
            raise HTTPException(status_code=401, detail='Guest conversations do not have saved sessions.')
        await asyncio.to_thread(
            _ensure_session_owner,
            req.session_id,
            user.id,
            effective_department,
        )

    # Greetings and identity questions need neither retrieval nor generation.
    if _is_model_question(req.question):
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': 0,
            'duplication_flagged': False,
            'fast_path': 'model_identity',
        })
        return ChatResponse(
            answer=_model_response(),
            sources=[],
            session_id=req.session_id,
            notice_type='conversation',
        )

    # Capability questions come before the greeting check: "what can you do"
    # deserves the answer to that question, not an introduction.
    if _is_capability_question(req.question):
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': 0,
            'duplication_flagged': False,
            'fast_path': 'capabilities',
        })
        return ChatResponse(
            answer=chat_notices.CAPABILITIES_MESSAGE,
            sources=[],
            session_id=req.session_id,
            notice_type='conversation',
        )

    if _is_courtesy_message(req.question):
        farewell = _is_farewell_message(req.question)
        variants = (
            chat_notices.FAREWELL_MESSAGES if farewell
            else chat_notices.COURTESY_MESSAGES
        )
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': 0,
            'duplication_flagged': False,
            'fast_path': 'farewell' if farewell else 'thanks',
        })
        return ChatResponse(
            answer=chat_notices.varied_message(variants, req.conversation_replies),
            sources=[],
            session_id=req.session_id,
            notice_type='conversation',
        )

    if _is_simple_conversation(req.question):
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': 0,
            'duplication_flagged': False,
            'fast_path': 'conversation',
        })
        return ChatResponse(
            answer=_conversation_response(req.question, req.conversation_replies),
            sources=[],
            session_id=req.session_id,
            notice_type='conversation',
        )

    # "Who built you" is about IskAI, never about a manuscript, so it needs no
    # conversational context and is answered here with the other self-directed
    # questions. The "this system" phrasing is handled further down, where the
    # conversation's own sources are known.
    if _is_system_origin_question(req.question):
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': 0,
            'duplication_flagged': False,
            'fast_path': 'system_origin',
        })
        return ChatResponse(
            answer=_origin_response(),
            sources=[],
            session_id=req.session_id,
            notice_type='conversation',
        )

    blocked_reason = prohibited_reason(req.question)
    if blocked_reason:
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query_blocked', {
            'reason': blocked_reason,
            'question_length': len(req.question),
        })
        return ChatResponse(answer=REFUSAL_MESSAGE, sources=[], session_id=req.session_id)

    # S2: turn an out-of-allowance guest away before the first paid call rather
    # than after. Everything below this point can reach Gemini — the follow-up
    # rewrite, the retrieval embedding, then generation itself.
    if not user and await asyncio.to_thread(guest_budget.is_exhausted):
        background_tasks.add_task(log_activity, None, 'chat_query_budget_exhausted', {
            'question_length': len(req.question),
            'stage': 'pre_retrieval',
        })
        return _guest_budget_response(req.session_id)

    # Authenticated history is loaded only after ownership verification. Guest
    # history is ephemeral, user-question-only context supplied by this open UI.
    history_messages: list[dict] = []
    reference_sources: list[dict] = []
    if req.session_id:
        history_messages = await asyncio.to_thread(_load_chat_history, req.session_id, user.id)
        if req.edit_from_turn is not None:
            history_messages = history_messages[:req.edit_from_turn]
        history_messages = [
            message for message in history_messages
            if not prohibited_reason(message.get('question', ''))
            and not _is_stored_non_answer(message.get('answer', ''))
        ]
        # Positional references such as “number 2” must mean the second source
        # shown in the immediately preceding answer, not a source from an older
        # turn in the saved conversation.
        latest_sources = next(
            (message.get('sources') or [] for message in reversed(history_messages) if message.get('sources')),
            [],
        )
        source_ids = list(dict.fromkeys(
            source.get('id') for source in latest_sources if source.get('id')
        ))
        if source_ids:
            reference_sources = await asyncio.to_thread(
                find_papers_by_ids,
                source_ids[:10],
                effective_department,
            )
    elif not user:
        history_messages = [
            {'question': question}
            for question in req.guest_history[-5:]
            if not prohibited_reason(question)
        ]
        try:
            reference_sources = await asyncio.to_thread(
                find_papers_by_ids,
                req.guest_source_ids,
                effective_department,
            )
        except Exception as e:
            # Memory enhancement is optional; retrieval must remain available.
            logger.warning('Guest reference lookup failed; continuing (%s)', type(e).__name__)
    chat_history_str = _format_chat_history(history_messages)
    prior_questions = [message['question'] for message in history_messages]

    if _is_archive_inventory_question(req.question, prior_questions):
        count_only = _is_archive_count_question(req.question, prior_questions)
        try:
            inventory_total, inventory_sources = await asyncio.to_thread(
                list_archive_papers,
                effective_department,
                req.thesis_category_filter,
                _ARCHIVE_INVENTORY_LIMIT,
            )
        except Exception as error:
            logger.exception('Archive inventory lookup failed')
            raise HTTPException(
                status_code=503,
                detail='The thesis archive is temporarily unavailable. Please try again in a moment.',
            ) from error
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': len(inventory_sources),
            'duplication_flagged': False,
            'fast_path': 'archive_inventory',
            'department': effective_department,
        })
        return ChatResponse(
            answer=_archive_inventory_response(
                effective_department,
                inventory_total,
                inventory_sources,
                count_only=count_only,
            ),
            sources=[] if count_only else inventory_sources,
            session_id=req.session_id,
            no_relevant_thesis=not inventory_total,
            archive_current=True,
        )

    # `who developed this system` resolves by context, not by wording. With an
    # archived source already on the table, "this system" is that manuscript's
    # system and the question stays a retrieval question. With none, there is
    # nothing for "this" to point at but IskAI, and answering it from semantic
    # search means naming whichever team's system chapter happens to rank
    # first -- right only while the archive is small enough to get lucky.
    if not reference_sources and _is_ambiguous_system_origin_question(req.question):
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': 0,
            'duplication_flagged': False,
            'fast_path': 'system_origin',
        })
        return ChatResponse(
            answer=_origin_response(),
            sources=[],
            session_id=req.session_id,
        )

    async def try_author_fast_path(question: str) -> ChatResponse | None:
        """Resolve person-name variants locally before any Gemini or embedding call."""
        author_name = _extract_author_name(question)
        if not author_name:
            return None
        try:
            author_sources = await asyncio.to_thread(
                find_papers_by_author,
                author_name,
                effective_department,
            )
        except Exception as e:
            logger.exception('Author metadata lookup failed')
            raise HTTPException(
                status_code=503,
                detail='The thesis archive is temporarily unavailable. Please try again in a moment.',
            ) from e

        # `What about data mining?` is not a person lookup. Soft follow-up
        # wording takes the fast path only when archive metadata confirms it.
        if not author_sources and not _is_explicit_author_identity_question(question):
            return None

        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': len(author_sources),
            'duplication_flagged': False,
            'fast_path': 'author_metadata',
        })
        return ChatResponse(
            answer=_author_lookup_response(author_name, author_sources),
            sources=author_sources,
            session_id=req.session_id,
            archive_current=True,
        )

    # Direct and `what about <name>` author questions do not need Gemini.
    author_response = await try_author_fast_path(req.question)
    if author_response:
        return author_response

    # Avoid repeatedly waiting on a provider that has just reported exhaustion.
    if _capacity_limit_is_active():
        return _capacity_response(req.session_id)

    effective_question = req.question
    referenced_paper_id = None
    is_overview_followup = False
    explicit_title = _extract_explicit_thesis_title(req.question)
    if explicit_title:
        try:
            title_matches = await asyncio.to_thread(
                find_papers_by_title,
                explicit_title,
                effective_department,
            )
        except Exception as error:
            logger.exception('Exact thesis title lookup failed')
            raise HTTPException(
                status_code=503,
                detail='The thesis archive is temporarily unavailable. Please try again in a moment.',
            ) from error
        if len(title_matches) == 1:
            referenced_paper_id = title_matches[0].get('id')

    # A thesis named by its opening words. Resolved only on a unique archive
    # match, so an ordinary follow-up ("what about their methodology") finds
    # nothing here and reaches the branches below unchanged.
    fragment_source = None
    if not referenced_paper_id and not explicit_title:
        title_fragment = _extract_thesis_title_fragment(req.question)
        if title_fragment:
            try:
                fragment_matches = await asyncio.to_thread(
                    find_papers_by_title_fragment,
                    title_fragment,
                    effective_department,
                )
            except Exception as error:
                # A guess, not a stated reference, so an unavailable lookup
                # degrades to the existing follow-up handling instead of
                # failing the turn. Retrieval below raises 503 on its own if
                # the archive really is down.
                logger.warning(
                    'Thesis title fragment lookup failed; continuing (%s)',
                    type(error).__name__,
                )
                fragment_matches = []
            if len(fragment_matches) == 1:
                fragment_source = fragment_matches[0]

    numbered_source = _resolve_numbered_thesis_reference(req.question, reference_sources)
    inline_reference = (
        None if numbered_source
        else _resolve_inline_thesis_reference(req.question, reference_sources)
    )
    if referenced_paper_id:
        pass
    elif fragment_source:
        # A bare title reference carries no question of its own, so it is
        # treated exactly like “number 2”: an overview of that one manuscript.
        effective_question = _overview_question_for_source(fragment_source)
        referenced_paper_id = fragment_source.get('id')
        is_overview_followup = True
    elif numbered_source:
        # The source order is server-verified from the preceding response, so
        # “number 2” cannot be misread as an objective number during semantic search.
        effective_question = _overview_question_for_source(numbered_source)
        referenced_paper_id = numbered_source.get('id')
        is_overview_followup = True
    elif inline_reference:
        # "what are the objectives of number 2": the reference names the thesis
        # and the rest of the sentence is the question about it. A specific
        # question, not an overview, and the numeral is gone from the wording.
        inline_source, effective_question = inline_reference
        referenced_paper_id = inline_source.get('id')
    elif _is_plural_source_followup(req.question, reference_sources):
        referenced_paper_id = [
            source['id'] for source in reference_sources if source.get('id')
        ]
    elif not explicit_title and is_ambiguous_followup(req.question, prior_questions):
        if len(reference_sources) >= 2:
            # The previous answer showed several theses and this follow-up does
            # not single one out. Pinning the first silently answered about the
            # wrong thesis; answering for each shown thesis, labelled with its
            # title, is what the reader can actually check.
            referenced_paper_id = [
                source['id'] for source in reference_sources if source.get('id')
            ]
            if _resolve_referenced_thesis(req.question, reference_sources):
                effective_question = _overview_question_for_sources(reference_sources)
                is_overview_followup = True
        else:
            effective_question = _resolve_referenced_thesis(req.question, reference_sources)
            is_overview_followup = bool(effective_question)
            if reference_sources:
                referenced_paper_id = reference_sources[0].get('id')
            if not effective_question:
                effective_question = (
                    _resolve_specific_paper_followup(req.question, reference_sources[0])
                    if reference_sources
                    else await _rewrite_followup(req.question, prior_questions, reference_sources)
                )
        rewritten_block = prohibited_reason(effective_question)
        if rewritten_block:
            background_tasks.add_task(log_activity, user.id if user else None, 'chat_query_blocked', {
                'reason': rewritten_block,
                'question_length': len(req.question),
                'after_rewrite': True,
            })
            return ChatResponse(answer=REFUSAL_MESSAGE, sources=[], session_id=req.session_id)

    # A rewritten follow-up may itself resolve to an author identity question.
    if effective_question != req.question:
        author_response = await try_author_fast_path(effective_question)
        if author_response:
            return author_response

    # Question shape, classified on the resolved wording (a rewritten
    # follow-up is the question retrieval actually answers). Aggregates sample
    # at most one chunk per thesis so a corpus-wide question sees distinct
    # studies instead of five chunks from whichever thesis ranked first.
    question_type = classify_question(effective_question)

    # 1. Retrieval phase (cosine similarity within the enforced department)
    try:
        async with safe_trace('rag.retrieval', metadata={
            'department': effective_department,
            'question_length': len(effective_question),
            'exact_paper': bool(referenced_paper_id),
            'embedding_model': settings.gemini_embed_model,
            'question_type': question_type,
        }) as retrieval_run:
            retrieval_result, alert_data = await _retrieve_evidence(
                effective_question,
                effective_department,
                referenced_paper_id,
                is_overview_followup,
                req.thesis_category_filter,
                per_paper_cap=1 if question_type == AGGREGATE else None,
            )
        context, sources, _top_similarity = retrieval_result
        if evaluation_trace is not None:
            # Private, in-process evidence for the formal research harness.
            # Never attach raw context to ChatResponse or persisted chat data.
            evaluation_trace.update({
                'context': context,
                'sources': sources,
                'top_similarity': _top_similarity,
            })
        if retrieval_run:
            retrieval_run.add_metadata({
                'source_count': len(sources),
                'top_similarity': round(_top_similarity, 6),
            })
    except Exception as e:
        logger.exception('Retrieval failed')
        if _is_capacity_error(e):
            _mark_capacity_limited()
            return _capacity_response(req.session_id)
        raise HTTPException(
            status_code=503,
            detail='The thesis archive is temporarily unavailable. Please try again in a moment.',
        ) from e

    # 2. Query-time 85% duplication guard
    duplication_alert = None
    if alert_data:
        # The summary call runs alongside the main answer generation below.
        alert_data['summary'] = ''

    # 3. Threshold enforcement: history can never substitute for current evidence.
    if not context:
        # A flagged match still has to reach the user here. This return passed
        # `duplication_alert`, which is only built after generation below, so it
        # was always None — the alert was computed and then silently dropped
        # whenever the retrieved context came back empty.
        return ChatResponse(
            answer=get_no_relevant_message(effective_department),
            sources=[],
            duplication_alert=DuplicationAlert(**alert_data) if alert_data else None,
            session_id=req.session_id,
            no_relevant_thesis=True,
            archive_current=True,
        )

    if _is_unsupported_single_token_query(req.question, context, sources):
        background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
            'question_length': len(req.question),
            'sources_cited': 0,
            'duplication_flagged': False,
            'fast_path': 'unclear_topic',
        })
        return ChatResponse(
            answer=chat_notices.UNCLEAR_TOPIC_MESSAGE,
            sources=[],
            session_id=req.session_id,
            kind='notice',
        )

    # S2: book this generation's worst-case cost against the shared daily guest
    # allowance. Charged before the call, because a ceiling that bills afterwards
    # cannot refuse the request that breaches it.
    if not user:
        budget_decision = await asyncio.to_thread(
            _charge_guest_generation,
            context, req.question, effective_question, chat_history_str,
        )
        if not budget_decision.allowed:
            logger.warning(
                'Guest daily token allowance exhausted: %d/%d tokens booked',
                budget_decision.spent, budget_decision.budget,
            )
            background_tasks.add_task(log_activity, None, 'chat_query_budget_exhausted', {
                'question_length': len(req.question),
                'stage': 'pre_generation',
                'charged': budget_decision.charged,
            })
            return _guest_budget_response(req.session_id)

    # 4. Generation phase
    try:
        if isinstance(referenced_paper_id, list):
            prompt_template = get_exact_papers_prompt(effective_department)
        elif is_overview_followup:
            prompt_template = get_overview_prompt(effective_department)
        elif referenced_paper_id:
            prompt_template = get_exact_paper_prompt(effective_department)
        else:
            prompt_template = get_rag_prompt(effective_department, question_type)
        generation_input = (
            {'context': context, 'question': effective_question}
            if referenced_paper_id
            else {
                'chat_history': chat_history_str or 'No previous history.',
                'context': context,
                'question': req.question,
                'resolved_question': effective_question,
            }
        )
        async with safe_trace('rag.generation', metadata={
            'department': effective_department,
            'source_count': len(sources),
            'model': settings.gemini_chat_model,
            'question_type': question_type,
        }) as generation_run:
            result, duplication_summary = await _invoke_generation(
                prompt_template, generation_input, alert_data,
            )
        if alert_data:
            alert_data['summary'] = duplication_summary
            duplication_alert = DuplicationAlert(**alert_data)
        if generation_run:
            generation_run.add_metadata({'status': 'completed'})
    except Exception as e:
        logger.exception('LLM generation failed')
        if _is_capacity_error(e):
            _mark_capacity_limited()
            return _capacity_response(req.session_id)
        raise HTTPException(
            status_code=502,
            detail='The research AI service is temporarily unavailable. Please try again later.',
        ) from e

    # Both no-evidence signals are computed ONCE, here, on the model's own
    # output, and never recomputed. `GROUNDED_FALLBACK_PREFIX` begins with
    # "I could not verify a direct answer", and "could not verify" is the first
    # entry in the phrase list, so re-running the detector after a fallback
    # substitution below would report `no_relevant_thesis` for a response that
    # `chat_notices` documents as deliberately NOT flagged.
    #
    # The sentinel is stripped from the raw text before anything else touches
    # it. Downstream, `_looks_like_misdirected_greeting` tests `startswith`, the
    # repair prompts interpolate the draft, and `enforce_citation_coverage`
    # would staple a marker onto the token's own line -- all of which a leading
    # token silently defeats.
    answer, sentinel_fired = prompts.strip_no_evidence_sentinel(_coerce_answer(result))
    # Read from the provider's stop reason, never inferred from the text: a
    # reply severed at the output ceiling is usually a well-formed prefix that
    # no downstream check can tell from a genuinely short answer. Measured on
    # the gateway route, one reply spent 1,920 of its 1,996 output tokens
    # reasoning, announced "two distinct systems", described one, and was still
    # served as finished work after the repair ladder stapled a marker onto it.
    generation_truncated = is_truncated(result)
    phrase_reports_no_evidence = _answer_reports_no_evidence(answer)
    reports_no_evidence = sentinel_fired or phrase_reports_no_evidence
    answer = normalize_citation_markers(answer)
    no_relevant_thesis = False

    # Structural citation validity alone does not prove that a plural response
    # covered every selected paper. Give the model one bounded correction, then
    # fall back safely below if it still omits a thesis. Skipped when the model
    # reported no usable evidence: there is nothing to spread across papers, and
    # the repair is an unbudgeted extra generation call.
    plural_paper_ids = referenced_paper_id if isinstance(referenced_paper_id, list) else []
    if (
        plural_paper_ids
        and not reports_no_evidence
        and not generation_truncated
        and _missing_referenced_papers(answer, sources, plural_paper_ids)
    ):
        try:
            repaired_plural, _ = prompts.strip_no_evidence_sentinel(
                await _repair_multi_paper_coverage(answer, req.question, context, sources)
            )
            answer = normalize_citation_markers(repaired_plural)
        except Exception as error:
            logger.warning('Multi-paper coverage repair failed (%s)', type(error).__name__)

    # A research question must never degrade into IskAI's introduction.
    if _looks_like_misdirected_greeting(answer):
        logger.warning('Rejected misdirected greeting for research question: %r', req.question[:120])
        answer = _grounded_retrieval_fallback(sources, effective_department)

    # 5. Structural citation validation and one bounded repair attempt.
    citation_repaired = False
    if generation_truncated:
        # Discarded rather than repaired. Every rung of the ladder below assumes
        # it is looking at a complete answer whose markers went missing; against
        # a fragment they instead make it *look* complete, which is the worst
        # available outcome: the reader cannot see that the reply stops early,
        # and a Ragas Answer Correctness score cannot either. The grounded
        # fallback is the same honest degradation used when repair fails.
        logger.warning(
            'Generation stopped at the output ceiling (%s tokens, gateway=%s); '
            'serving the grounded retrieval fallback instead of a fragment',
            gemini_pool.active_output_ceiling(),
            gemini_pool.gateway_enabled(),
        )
        answer = _grounded_retrieval_fallback(sources, effective_department)
        unique_sources = filter_cited_sources(answer, sources)
    elif reports_no_evidence:
        # Keep the model's own account of what the archive *does* cover, and the
        # sources it cited for it. This branch used to replace all of that with
        # the generic message and clear the sources, so "the archive has nothing
        # on X, but covers Y [1]" -- a genuinely useful answer -- was destroyed.
        #
        # The repair ladder is bypassed deliberately, not merely tolerated.
        # `enforce_citation_coverage` maps every uncited unit to the first
        # source, so "the archive does not cover attendance monitoring" would
        # have `[1]` stapled to it and the answer would assert that source 1
        # supports a negative claim about the archive. That is a faithfulness
        # defect and it would score as one in Ragas. Bypassing also avoids up to
        # two extra generation calls that the guest allowance never charged for,
        # on exactly the queries that produce no answer.
        unique_sources = filter_cited_sources(answer, sources)
        if not answer.strip() or not unique_sources:
            # Nothing survived worth showing: fall back to the generic notice,
            # which is what this branch always did.
            answer = get_no_relevant_message(effective_department)
            unique_sources = []
            no_relevant_thesis = True
    else:
        missing_papers = _missing_referenced_papers(answer, sources, plural_paper_ids)
        valid, citation_errors = validate_citations(answer, sources)
        if missing_papers:
            valid = False
            citation_errors.append(f'missing referenced papers: {missing_papers}')
        if not valid:
            try:
                repaired = normalize_citation_markers(
                    await _repair_citations(answer, context, sources)
                )
                repaired_valid, repaired_errors = validate_citations(repaired, sources)
                repaired_missing = _missing_referenced_papers(
                    repaired, sources, plural_paper_ids,
                )
                if repaired_missing:
                    repaired_valid = False
                    repaired_errors.append(f'missing referenced papers: {repaired_missing}')
                if repaired_valid:
                    answer = repaired
                    citation_repaired = True
                else:
                    structurally_repaired = enforce_citation_coverage(repaired, sources)
                    structural_valid, structural_errors = validate_citations(
                        structurally_repaired,
                        sources,
                    )
                    structural_missing = _missing_referenced_papers(
                        structurally_repaired, sources, plural_paper_ids,
                    )
                    if structural_missing:
                        structural_valid = False
                        structural_errors.append(
                            f'missing referenced papers: {structural_missing}'
                        )
                    if structural_valid:
                        answer = structurally_repaired
                        citation_repaired = True
                    else:
                        logger.warning(
                            'Citation repair remained invalid: ai=%s deterministic=%s',
                            repaired_errors,
                            structural_errors,
                        )
                        answer = _grounded_retrieval_fallback(sources, effective_department)
            except Exception as e:
                logger.warning(
                    'Citation repair failed (%s); original errors=%s',
                    type(e).__name__,
                    citation_errors,
                )
                answer = _grounded_retrieval_fallback(sources, effective_department)
        unique_sources = filter_cited_sources(answer, sources)

    background_tasks.add_task(log_activity, user.id if user else None, 'chat_query', {
        'question_length': len(req.question),
        'sources_cited': len(unique_sources),
        'duplication_flagged': bool(duplication_alert),
        'citation_repaired': citation_repaired,
        'department': effective_department,
        'question_type': question_type,
    })

    return ChatResponse(
        answer=answer,
        sources=unique_sources,
        duplication_alert=duplication_alert,
        session_id=req.session_id,
        no_relevant_thesis=no_relevant_thesis,
        archive_current=True,
    )
