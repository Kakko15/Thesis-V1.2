from fastapi import APIRouter
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from config import settings
from services.retriever import search_chunks
from models import ChatRequest, ChatResponse

router = APIRouter(prefix='/chat', tags=['chat'])

llm = ChatGoogleGenerativeAI(
    model='gemini-3.1-flash-lite',
    google_api_key=settings.gemini_api_key,
    temperature=0.3
)

RAG_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a research assistant for a thesis library.
Answer the question using ONLY the provided context from academic papers.
Be concise, accurate, and cite which papers you used.
If the context does not contain the answer, say so clearly."""),
    ("human", """Context:
{context}

Question: {question}""")
])

chain = RAG_PROMPT | llm

@router.post('', response_model=ChatResponse)
async def chat(req: ChatRequest):
    try:
        context, sources = search_chunks(
            req.question, req.match_count, req.match_threshold
        )
        if not context:
            return ChatResponse(
                answer='No relevant papers found. Try uploading more papers.',
                sources=[]
            )
        result = chain.invoke({"context": context, "question": req.question})
        answer_content = result.content if hasattr(result, 'content') else str(result)
        
        # In newer LangChain versions, content might be a list of blocks instead of a string
        if isinstance(answer_content, list):
            answer = "".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in answer_content
            )
        else:
            answer = str(answer_content)
        unique_sources = {s['id']: s for s in sources if s}.values()
        return ChatResponse(answer=answer, sources=list(unique_sources))
    except Exception as e:
        return ChatResponse(
            answer=f'An error occurred while processing your question: {str(e)}',
            sources=[]
        )
