from langchain_text_splitters import RecursiveCharacterTextSplitter
 
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1500,      # characters (~500 tokens)
    chunk_overlap=150,    # overlap to preserve context
    separators=[
        '\n\n', '\n',   # prefer paragraph breaks
        '. ', ' ', ''
    ]
)
 
def split_text(text: str) -> list[str]:
    return splitter.split_text(text)
