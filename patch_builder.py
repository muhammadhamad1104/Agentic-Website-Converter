import sys

with open('apps/worker/src/engine/package_builder.py', 'r') as f:
    content = f.read()

# 1. Add imports
import_block = """import json
from pathlib import Path
import shutil
from typing import Any
import requests
from urllib.parse import urlparse
import logging
import re
from src.engine.failover_llm import FailoverLLM"""
content = content.replace("import json\nfrom pathlib import Path\nimport shutil\nfrom typing import Any", import_block)

# 2. Update build_dynamic_site_package signature
old_sig = """def build_dynamic_site_package(
    job_id: str,
    schema: dict[str, Any],
    output_root: str,
    template_dir: str | None = None,
    input_url: str | None = None,
) -> dict[str, Any]:"""
new_sig = """def build_dynamic_site_package(
    job_id: str,
    schema: dict[str, Any],
    output_root: str,
    template_dir: str | None = None,
    input_url: str | None = None,
    crawled_pages: dict[str, str] | None = None,
    asset_urls: list[str] | None = None,
    llm: FailoverLLM | None = None,
) -> dict[str, Any]:"""
content = content.replace(old_sig, new_sig)

# 3. Add AI Enrichment and Asset Download functions
ai_functions = """
def _download_assets(asset_urls: list[str], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for url in asset_urls:
        try:
            parsed = urlparse(url)
            filename = Path(parsed.path).name
            if not filename:
                continue
            
            # Avoid downloading super huge files over 50MB
            # Just do a stream download
            res = requests.get(url, stream=True, timeout=10)
            if res.status_code == 200:
                with open(output_dir / filename, 'wb') as f:
                    for chunk in res.iter_content(chunk_size=8192):
                        f.write(chunk)
                logging.info(f"Downloaded asset: {filename}")
        except Exception as e:
            logging.warning(f"Failed to download asset {url}: {e}")

def _enrich_frontend_with_ai(project_dir: Path, crawled_pages: dict[str, str], llm: FailoverLLM, brand_name: str) -> None:
    frontend_pages_dir = project_dir / "frontend" / "src" / "pages"
    
    for url, html_content in crawled_pages.items():
        if not html_content.strip():
            continue
            
        parsed = urlparse(url)
        path = parsed.path.strip("/")
        if not path:
            page_name = "Home"
        else:
            page_name = _pascal_name(path)
            
        logging.info(f"Using AI to generate React component for page: {page_name}")
        
        prompt = f\"\"\"
You are an expert frontend developer building a React application.
I will provide you with the raw HTML of a crawled webpage. 
Your task is to convert this HTML into a dynamic, beautiful, production-ready React (JSX) component and its accompanying CSS.
Do not generate the entire HTML document, just the React component structure.
Make sure to extract and use any images, styling, and structural elements to make it look like a modern, premium design.

Brand Name: {brand_name}
Page Name: {page_name}

Raw HTML:
```html
{html_content[:5000]} # Truncated to avoid token limits for this prompt
```

Return your response as a JSON object strictly following this structure:
{{
    "jsx": "import React from 'react';\\nimport './{page_name}.css';\\n\\nexport default function {page_name}() {{ ... }}",
    "css": ".{page_name.lower()} {{ ... }}"
}}
\"\"\"
        try:
            response = llm.invoke(prompt)
            # Find JSON in response
            match = re.search(r'\\{.*?\\}', response, re.DOTALL)
            if match:
                json_str = match.group(0)
                data = json.loads(json_str)
                
                page_dir = frontend_pages_dir / page_name
                page_dir.mkdir(parents=True, exist_ok=True)
                
                _write_text(page_dir / f"{page_name}.jsx", data.get("jsx", ""))
                _write_text(page_dir / f"{page_name}.css", data.get("css", ""))
                logging.info(f"Successfully enriched {page_name} with AI.")
        except Exception as e:
            logging.error(f"Failed to enrich {page_name} with AI: {e}")

def build_dynamic_site_package(
"""
content = content.replace("def build_dynamic_site_package(", ai_functions)

# 4. Call _download_assets and _enrich_frontend_with_ai inside build_dynamic_site_package
# Right after _build_frontend(project_dir=project_dir, entity_names=entity_names, brand_name=brand_name, site_title=site_title, site_desc=site_desc)
hook_injection = """    _build_frontend(project_dir=project_dir, entity_names=entity_names, brand_name=brand_name, site_title=site_title, site_desc=site_desc)

    if asset_urls:
        _download_assets(asset_urls, project_dir / "frontend" / "public" / "assets")
        
    if crawled_pages and llm:
        _enrich_frontend_with_ai(project_dir, crawled_pages, llm, brand_name)"""
content = content.replace("    _build_frontend(project_dir=project_dir, entity_names=entity_names, brand_name=brand_name, site_title=site_title, site_desc=site_desc)", hook_injection)

with open('apps/worker/src/engine/package_builder.py', 'w') as f:
    f.write(content)
