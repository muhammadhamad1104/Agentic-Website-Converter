#!/usr/bin/env python3
"""Export the actual compiled workflow plus a slide-friendly grouped view.

Run with the worker's Python dependencies; matplotlib is needed for the slide.
The optional native PNG uses LangGraph's Mermaid renderer (diagram data only).
No workflow nodes, crawls, or LLM requests are executed.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "worker"))


def slide(graph, output):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

    ink, green, muted = "#1B3028", "#3B6653", "#697770"
    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.fonttype": "none"})
    fig, ax = plt.subplots(figsize=(16, 9), facecolor="white")
    fig.subplots_adjust(left=0, right=1, bottom=0, top=1)
    ax.set(xlim=(0, 16), ylim=(0, 9))
    ax.axis("off")

    def text(x, y, value, size=12, color=ink, **kwargs):
        ax.text(x, y, value, fontsize=size, color=color, va="center", **kwargs)

    def arrow(start, end, color=green, dashed=False, curve=0, width=1.6):
        ax.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>", mutation_scale=15,
                                    linewidth=width, color=color,
                                    linestyle="--" if dashed else "-",
                                    connectionstyle=f"arc3,rad={curve}", zorder=2))

    phases = [
        ("01", "Capture", 0.55, 4.65, [
            ("crawl_site", "Capture pages and assets"),
            ("sitemap_gate", "Check capture coverage"),
            ("extract_content", "Extract content evidence")]),
        ("02", "Infer Structure", 5.65, 4.65, [
            ("infer_candidates", "Identify content candidates"),
            ("infer_schema", "Infer relational schema")]),
        ("03", "Human Review", 10.75, 4.65, [
            ("schema_review_gate", "Approve or request revision"),
            ("mint_schema_version", "Version the approved schema")]),
        ("04", "Prepare", 10.75, 1.05, [
            ("generation_gate", "Check generation approval"),
            ("prepare_template_scaffold", "Prepare the application scaffold")]),
        ("05", "Generate", 5.65, 1.05, [
            ("generate_backend", "Backend and database"),
            ("generate_frontend", "Source-preserving frontend"),
            ("generate_admin", "Content management admin")]),
        ("06", "Validate And Package", 0.55, 1.05, [
            ("validate_consistency", "Check artifact consistency"),
            ("validate_build_smoke", "Build and runtime smoke tests"),
            ("validation_review_gate", "Review validation results"),
            ("package_export", "Mark package approved")]),
    ]
    grouped = {identifier for _, _, _, _, nodes in phases for identifier, _ in nodes}
    assert grouped == set(graph.nodes) - {"__start__", "__end__", "END_CANCELLED"}

    text(0.55, 8.35, "LangGraph Conversion Workflow", 27, weight="bold")
    text(0.55, 7.86, "Agentic Converter  /  Python worker orchestration", 13, color=muted)
    text(15.45, 8.32, "SOURCE-PRESERVING", 10, color=green, ha="right", weight="bold")
    ax.plot([0.55, 15.45], [7.5, 7.5], color="#DDE5E0", linewidth=1)

    for number, title, x, y, nodes in phases:
        text(x, y + 2.38, number, 11, color=green, weight="bold")
        text(x + 0.38, y + 2.38, title, 17, weight="bold")
        spacing = 0.62
        for index, (identifier, label) in enumerate(nodes):
            node_y = y + 1.86 - index * spacing
            ax.add_patch(FancyBboxPatch((x, node_y - 0.215), 4.7, 0.47,
                         boxstyle="round,pad=0.015,rounding_size=0.045",
                         linewidth=0.9, edgecolor="#D3DED6",
                         facecolor="#F3F7F4" if number != "03" else "#EDF3F7", zorder=3))
            text(x + 0.16, node_y + 0.09, label, 11, zorder=4)
            text(x + 0.16, node_y - 0.1, identifier, 8, color=muted,
                 fontfamily="DejaVu Sans Mono", zorder=4)
            if index:
                arrow((x + 2.35, node_y + spacing - 0.24), (x + 2.35, node_y + 0.27), width=1)

    # Inter-phase arrows summarize the successful path, not additional graph edges.
    arrow((5.28, 5.85), (5.57, 5.85))
    arrow((10.38, 5.85), (10.67, 5.85))
    arrow((13.1, 4.74), (13.1, 3.69))
    text(13.32, 4.12, "Approved", 10, color=green)
    arrow((10.67, 2.65), (10.38, 2.65))
    arrow((5.57, 2.65), (5.28, 2.65))

    # Branch annotations are deliberately grouped; the full graph retains all edges.
    arrow((11.1, 4.75), (8.0, 4.75), color="#926F36", dashed=True, curve=-0.30)
    text(9.48, 4.08, "Revision requested", 10, color="#926F36", ha="center")
    text(10.75, 4.93, "Workflow pauses while approval is pending.", 9, color="#526B7D")
    text(0.55, 0.61, "RETRY PATHS", 9, color="#926F36", weight="bold")
    text(2.0, 0.61, "Capture retry  /  schema revision  /  targeted regeneration (bounded budgets)", 10, color=muted)
    text(0.55, 0.26, "Terminal failure: END_CANCELLED    |    Successful package: __end__    |    Preview and ZIP download are separate API actions.", 9, color=muted)
    for suffix in ("png", "svg", "pdf"):
        fig.savefig(output / f"langgraph-ppt.{suffix}", dpi=300, facecolor="white")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs" / "assets" / "langgraph")
    parser.add_argument("--native-png", action="store_true", help="Also render the complete graph through Mermaid.ink")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    # Diagram export needs no credentials. Avoid loading the application's .env.
    previous_directory = Path.cwd()
    try:
        with tempfile.TemporaryDirectory(prefix="langgraph-export-") as directory:
            os.chdir(directory)
            from src.engine.workflow import build_conversion_workflow
    finally:
        os.chdir(previous_directory)

    graph = build_conversion_workflow().get_graph()
    (args.output / "langgraph-full.mmd").write_text(graph.draw_mermaid(), encoding="utf-8")
    (args.output / "langgraph-full.json").write_text(json.dumps({
        "nodes": list(graph.nodes),
        "edges": [{"source": edge.source, "target": edge.target,
                   "conditional": edge.conditional, "label": edge.data} for edge in graph.edges],
    }, indent=2), encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="langgraph-matplotlib-") as directory:
        os.environ.setdefault("MPLCONFIGDIR", directory)
        slide(graph, args.output)
    if args.native_png:
        from langchain_core.runnables.graph import NodeStyles

        graph.draw_mermaid_png(output_file_path=str(args.output / "langgraph-full.png"),
            node_colors=NodeStyles(default="fill:#eff5f0,stroke:#6b8675,color:#1b3028",
                                  first="fill:#244e3c,stroke:#244e3c,color:#ffffff",
                                  last="fill:#dce8e0,stroke:#6b8675,color:#1b3028"),
            background_color="white", padding=24, max_retries=1,
            frontmatter_config={"theme": "base", "themeVariables": {
                "fontFamily": "Arial", "fontSize": "18px", "lineColor": "#6b8675"}})
    print(f"Exported {len(graph.nodes)} nodes and {len(graph.edges)} edges to {args.output}")


if __name__ == "__main__":
    main()
