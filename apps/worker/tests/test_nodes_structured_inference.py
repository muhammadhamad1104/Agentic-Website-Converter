from __future__ import annotations

from src.engine.nodes import infer_schema_node


HTML_SAMPLE = """
<html>
  <body>
    <article class=\"service-card\"><h2>Consulting</h2><p>Text</p><a href=\"/x\">Details</a></article>
    <article class=\"service-card\"><h2>Delivery</h2><p>Text</p><a href=\"/y\">Details</a></article>
    <article class=\"service-card\"><h2>Support</h2><p>Text</p><a href=\"/z\">Details</a></article>
  </body>
</html>
"""


class _StructuredLLM:
    def invoke(self, prompt: str) -> str:
        return """
        {
          "entities": [
            {
              "name": "Service",
              "confidence": 0.91,
              "evidence": ["class=service-card", "repeated article structure"],
              "fields": [
                {"name": "title", "type": "string", "confidence": 0.95, "evidence": ["h2"]},
                {"name": "description", "type": "text", "confidence": 0.8, "evidence": ["p"]},
                {"name": "url", "type": "url", "confidence": 0.9, "evidence": ["a[href]"]}
              ]
            }
          ],
          "relationships": [],
          "assumptions": ["Services are independent records"]
        }
        """


class _InvalidLLM:
    def invoke(self, prompt: str) -> str:
        return "not-json"


class _PromptCaptureLLM:
    def __init__(self) -> None:
        self.last_prompt = ""

    def invoke(self, prompt: str) -> str:
        self.last_prompt = prompt
        return """
        {
          "entities": [
            {
              "name": "Service",
              "confidence": 0.9,
              "fields": [
                {"name": "title", "type": "string", "confidence": 0.9, "evidence": ["service-card"]}
              ]
            }
          ],
          "relationships": [],
          "assumptions": ["captured"]
        }
        """


def test_infer_schema_prefers_structured_llm_payload() -> None:
    state = {"html_pages": [HTML_SAMPLE], "schema_decision": "pending", "errors": []}
    result = infer_schema_node(state, llm=_StructuredLLM())

    assert result["status"] == "schema_proposed"
    assert result["schema_proposal"]["entities"][0]["name"] == "Service"
    assert result["schema_proposal"]["entities"][0]["fields"][0]["evidence"]
    assert any("structured json" in item.lower() for item in result["schema_proposal"]["assumptions"])


def test_infer_schema_falls_back_when_llm_payload_invalid() -> None:
    state = {"html_pages": [HTML_SAMPLE], "schema_decision": "pending", "errors": []}
    result = infer_schema_node(state, llm=_InvalidLLM())

    assert result["status"] == "schema_proposed"
    assert result["schema_proposal"]["entities"]
    assert any("heuristic" in item.lower() for item in result["schema_proposal"]["assumptions"])


def test_infer_schema_uses_extracted_blocks_as_prompt_evidence() -> None:
  llm = _PromptCaptureLLM()
  state = {
    "html_pages": ["<html><body><div>fallback html</div></body></html>"],
    "extracted_blocks": ["<article class='service-card'><h2>Consulting</h2></article>"],
    "schema_decision": "pending",
    "errors": [],
  }

  result = infer_schema_node(state, llm=llm)

  assert result["status"] == "schema_proposed"
  assert "EXTRACTED_BLOCK_1" in llm.last_prompt
  assert "service-card" in llm.last_prompt
  assert result["schema_quality_report"]["inference_sources"]["used_extracted_blocks"] is True
