import sys

with open('apps/worker/src/engine/service.py', 'r') as f:
    lines = f.readlines()

new_lines = lines[:38] # Keep up to "self.store = store"

correct_middle = """        else:
            try:
                self.store = SqliteJobStore(settings.JOB_STORE_PATH)
            except Exception:
                self.store = InMemoryJobStore()
        self._llm = self._build_failover_llm()
        self.workflow = build_conversion_workflow(
            infer_node=lambda state: infer_schema_node(state, llm=self._llm),
            llm=self._llm,
        )

    @traced("engine.build_failover_llm")
    def _build_failover_llm(self) -> FailoverLLM:
        models = []

        # Priority 1: Kimi (Moonshot)
        if getattr(settings, "KIMI_API_KEY", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                kimi = ChatOpenAI(
                    model=getattr(settings, "KIMI_MODEL", "moonshot-v1-8k"),
                    api_key=settings.KIMI_API_KEY,
                    base_url="https://api.moonshot.ai/v1",
                    temperature=0.0
                )
                models.append(LangChainChatAdapter(kimi))
            except Exception:
                pass

        # Priority 2: DeepSeek
        if getattr(settings, "DEEPSEEK_API_KEY", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                deepseek = ChatOpenAI(
                    model=getattr(settings, "DEEPSEEK_MODEL", "deepseek-chat"),
                    api_key=settings.DEEPSEEK_API_KEY,
                    base_url="https://api.deepseek.com/v1",
                    temperature=0.0
                )
                models.append(LangChainChatAdapter(deepseek))
            except Exception:
                pass

        # Priority 3: OpenAI
        if getattr(settings, "OPENAI_API_KEY", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                openai = ChatOpenAI(
                    model=getattr(settings, "OPENAI_MODEL", "gpt-4o-mini"), 
                    api_key=settings.OPENAI_API_KEY, 
                    temperature=0.0
                )
                models.append(LangChainChatAdapter(openai))
            except Exception:
                pass

        # Priority 4: Groq
        if getattr(settings, "GROQ_API_KEY", None):
            try:
                ChatGroq = getattr(importlib.import_module("langchain_groq"), "ChatGroq")
                groq = ChatGroq(
                    model=getattr(settings, "GROQ_MODEL", "llama-3.3-70b-versatile"), 
                    api_key=settings.GROQ_API_KEY, 
                    temperature=0.0
                )
                models.append(LangChainChatAdapter(groq))
            except Exception:
                pass

        # Priority 5: Gemini
        if getattr(settings, "GEMINI_API_KEY", None):
            try:
                ChatGoogleGenerativeAI = getattr(
                    importlib.import_module("langchain_google_genai"),
                    "ChatGoogleGenerativeAI",
                )
                gemini = ChatGoogleGenerativeAI(
                    model=getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash"),
                    google_api_key=settings.GEMINI_API_KEY,
                    temperature=0.0,
                )
                models.append(LangChainChatAdapter(gemini))
            except Exception:
                pass

        # Priority 6: Open Source
        if getattr(settings, "OPEN_SOURCE_API_KEY", None) and getattr(settings, "OPEN_SOURCE_BASE_URL", None):
            try:
                ChatOpenAI = getattr(importlib.import_module("langchain_openai"), "ChatOpenAI")
                opensource = ChatOpenAI(
                    model=getattr(settings, "OPEN_SOURCE_MODEL", "default-model"),
                    api_key=settings.OPEN_SOURCE_API_KEY,
                    base_url=settings.OPEN_SOURCE_BASE_URL,
                    temperature=0.0
                )
                models.append(LangChainChatAdapter(opensource))
            except Exception:
                pass

        # Priority 7: Anthropic
        if getattr(settings, "ANTHROPIC_API_KEY", None):
            try:
                ChatAnthropic = getattr(importlib.import_module("langchain_anthropic"), "ChatAnthropic")
                anthropic = ChatAnthropic(
                    model="claude-3-5-sonnet-20240620", 
                    api_key=settings.ANTHROPIC_API_KEY, 
                    temperature=0.0
                )
                models.append(LangChainChatAdapter(anthropic))
            except Exception:
                pass

        if not models:
            models.append(_UnavailableLLM("No LLM providers available: missing API keys or dependencies"))

        return FailoverLLM(models=models)

    def _default_crawl_config(self) -> dict[str, Any]:
        return {
            "depth_limit": settings.CRAWL_DEPTH_LIMIT_DEFAULT,
"""

new_lines.append(correct_middle)

# find where _normalize_crawl_config starts
start_idx = 0
for i, line in enumerate(lines):
    if "def _normalize_crawl_config" in line:
        start_idx = i
        break

# The lines before that start with "max_pages" which we need to skip.
# Actually wait, _normalize_crawl_config is line 53 in the current corrupted file. Let's append from 38 down to 52?
# In the current file:
# 38:             "max_pages": settings.CRAWL_MAX_PAGES_DEFAULT,
# ...
# 51:         }
# 52: 
# 53:     def _normalize_crawl_config...

# Our correct_middle ends with "depth_limit": settings.CRAWL_DEPTH_LIMIT_DEFAULT,\n
# We can just append from line 38 onwards!

new_lines.extend(lines[38:])

with open('apps/worker/src/engine/service.py', 'w') as f:
    f.writelines(new_lines)
