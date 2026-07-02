from fastapi import APIRouter, Depends
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from config import settings
from services.retriever import search_chunks
from models import ChatRequest, ChatResponse
from dependencies.auth import get_optional_user, sb

router = APIRouter(prefix='/chat', tags=['chat'])

llm = ChatGoogleGenerativeAI(
    model='gemini-3.1-flash-lite',
    google_api_key=settings.gemini_api_key,
    temperature=0.6
)

RAG_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are Thesis AI Library, a friendly and highly capable research assistant.
Engage with the user in a natural, conversational, and assistive tone.
CRITICAL RULES:
1. If the user just says "Hi", "Hello", or gives a simple greeting, respond briefly with: "Hello! I'm Thesis AI Library, how can I help you look for a specific thesis paper?" or something very similar. Do NOT be verbose.
2. Keep all your responses concise and directly address the user's input.
3. When answering questions, use the provided Context from the academic papers.
4. Also take into account the Chat History of the current conversation to answer follow-up questions gracefully.
5. If the context does not contain the exact answer, politely mention what you *do* know from the papers in a helpful, brief way. 
6. Always aim to be insightful, clear, and engaging. Cite the papers naturally in your response when applicable.
7. CRITICAL: Never string multiple citations together for the same paper (e.g. do not write [1, 2, 3]). Use a single, clean citation like [1].
8. CRITICAL: If you did NOT use ANY information from the Context to generate your response (for example, if the user just said 'hi', or asked an irrelevant question where you couldn't find an answer in the context), you MUST start your response with the exact phrase: [NO_SOURCES_USED]"""),
    ("human", """Chat History:
{chat_history}

Context:
{context}

Question: {question}""")
])

chain = RAG_PROMPT | llm

@router.post('', response_model=ChatResponse)
async def chat(req: ChatRequest, user = Depends(get_optional_user)):
    try:
        # 1. Retrieve current context
        context, sources = search_chunks(
            req.question, req.match_count, req.match_threshold
        )
        
        # 2. Retrieve Chat History if session exists
        chat_history_str = ""
        if req.session_id:
            past_msgs = sb.table('chat_messages') \
                .select('question, answer') \
                .eq('session_id', req.session_id) \
                .order('created_at', desc=False) \
                .limit(5) \
                .execute()
            
            if past_msgs.data:
                import re
                for msg in past_msgs.data:
                    # Strip out [1], [2] etc from past AI answers so it doesn't reuse stale citation numbers
                    clean_answer = re.sub(r'\[\d+\]', '', msg['answer'])
                    chat_history_str += f"Human: {msg['question']}\nAI: {clean_answer}\n\n"

        if not context and not chat_history_str:
            return ChatResponse(
                answer='No relevant papers found for that query, and no chat history exists yet. Try uploading more papers.',
                sources=[]
            )
            
        # 3. Invoke AI
        result = chain.invoke({
            "chat_history": chat_history_str or "No previous history.",
            "context": context or "No context found.", 
            "question": req.question
        })
        
        answer_content = result.content if hasattr(result, 'content') else str(result)
        
        if isinstance(answer_content, list):
            answer = "".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in answer_content
            )
        else:
            answer = str(answer_content)
            
        import re
        
        # Check if AI explicitly stated it didn't use sources
        used_sources = True
        if answer.strip().startswith('[NO_SOURCES_USED]'):
            used_sources = False
            answer = answer.replace('[NO_SOURCES_USED]', '').strip()
            
            # Fetch 3 most recently added papers
            recent_papers_res = sb.table('papers') \
                .select('id,title,authors,year,pdf_url') \
                .order('created_at', desc=True) \
                .limit(3) \
                .execute()
            unique_sources = recent_papers_res.data or []
        else:
            # Extract cited numbers (e.g. [1], [2], [4]) from the AI's answer
            cited_indices = set(map(int, re.findall(r'\[(\d+)\]', answer)))
            
            if cited_indices:
                # Filter the sources list to only include the ones the AI actually cited
                filtered_sources = [sources[i-1] for i in cited_indices if 1 <= i <= len(sources)]
            else:
                # If AI didn't cite anything, assume it answered from memory/history.
                # DO NOT fallback to showing all sources, because semantic search might have returned irrelevant papers.
                filtered_sources = []
                
            # Deduplicate the filtered sources
            unique_sources = list({s['id']: s for s in filtered_sources if s}.values())
        
        # 4. Save to history if user is logged in
        if user:
            session_id = req.session_id
            
            # If no session_id, auto-create a session
            if not session_id:
                new_sess = sb.table('chat_sessions').insert({
                    'user_id': user.id,
                    'title': req.question[:40] + ('...' if len(req.question) > 40 else '')
                }).execute()
                if new_sess.data:
                    session_id = new_sess.data[0]['id']
            
            if session_id:
                sb.table('chat_messages').insert({
                    'session_id': session_id,
                    'question': req.question,
                    'answer': answer,
                    'sources': unique_sources
                }).execute()

        return ChatResponse(answer=answer, sources=unique_sources)
    except Exception as e:
        return ChatResponse(
            answer=f'An error occurred while processing your question: {str(e)}',
            sources=[]
        )
