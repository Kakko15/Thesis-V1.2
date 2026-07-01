import logging
from config import settings
from langchain_google_genai import GoogleGenerativeAIEmbeddings

logger = logging.getLogger(__name__)

# Initialize the primary embedding model with a dimension limit
embeddings_model = GoogleGenerativeAIEmbeddings(
    model='models/gemini-embedding-2',
    google_api_key=settings.gemini_api_key,
    output_dimensionality=768  # <--- This is the magic fix!
)

def embed_text(text: str) -> list[float]:
    """
    Generates a vector embedding for a single text string (e.g., a search query).
    """
    try:
        return embeddings_model.embed_query(text)
    except Exception as e:
        logger.error(f"Embedding generation failed: {e}")
        raise

def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Generates vector embeddings for a list of text strings (e.g., documents/chunks).
    """
    try:
        return embeddings_model.embed_documents(texts)
    except Exception as e:
        logger.error(f"Batch embedding generation failed: {e}")
        raise