# LangGraph Presentation Images

- `langgraph-ppt.png`: 4800 x 2700, white-background 16:9 overview for the main slide.
- `langgraph-ppt.svg`: scalable, editable vector version for PowerPoint.
- `langgraph-ppt.pdf`: vector version for printing.
- `langgraph-full.png`: native LangGraph visualization for a technical appendix.
- `langgraph-full.mmd`: editable Mermaid source exported from the compiled graph.
- `langgraph-full.json`: compiled node and edge data.

Source: `apps/worker/src/engine/workflow.py`, using
`build_conversion_workflow().get_graph()`. The compiled graph contains 19 nodes
(including start, end and cancellation) and 43 edges.

The slide overview groups all 16 functional nodes into six phases. Its arrows
summarize the successful flow; retry and failure routes are summarized in notes.
Use the full diagram to show individual conditional routes. These six phases are
graph groupings, not the seven screens of the conversion wizard.

Human schema approval is required. Preview startup and physical ZIP creation are
separate API actions after generation, not additional compiled graph nodes.

To regenerate with worker Python dependencies and matplotlib installed:

```bash
python scripts/export-langgraph.py
python scripts/export-langgraph.py --native-png
```

The native PNG option uses Mermaid.ink and requires network access. Only graph
syntax is transmitted. The script does not execute workflow nodes, run conversions,
call an LLM, load project credentials, or modify deployed services/databases.
