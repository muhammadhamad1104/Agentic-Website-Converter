import sys
from pathlib import Path

path = Path('apps/worker/src/engine/package_builder.py')
content = path.read_text()

new_enrich = """def _enrich_frontend_with_ai(project_dir: Path, crawled_pages: dict[str, str], llm: FailoverLLM, brand_name: str) -> None:
    frontend_pages_dir = project_dir / "frontend" / "src" / "pages"
    
    routes_imports = []
    routes_components = []
    
    for url, html_content in crawled_pages.items():
        if not html_content.strip():
            continue
            
        parsed = urlparse(url)
        path_str = parsed.path.strip("/")
        if not path_str:
            page_name = "Home"
            route_path = "/"
        else:
            page_name = _pascal_name(path_str)
            route_path = f"/{path_str}"
            
        routes_imports.append(f"import {page_name} from './pages/{page_name}/{page_name}';")
        routes_components.append(f'          <Route path="{route_path}" element={{<{page_name} />}} />')
            
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
{html_content[:5000]}
```

Return your response as a JSON object strictly following this structure:
{{
    "jsx": "import React from 'react';\\nimport './{page_name}.css';\\n\\nexport default function {page_name}() {{ ... }}",
    "css": ".{page_name.lower()} {{ ... }}"
}}
\"\"\"
        try:
            response = llm.invoke(prompt)
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

    # Dynamically update App.jsx to point to the newly generated routes
    app_jsx = f\"\"\"import {{ Route, Routes }} from 'react-router-dom';

import Header from './components/Header/Header';
import Footer from './components/Footer/Footer';
import ScrollToTop from './components/ScrollToTop/ScrollToTop';
{chr(10).join(routes_imports)}
import AdminDashboard from './pages/Admin/AdminDashboard';
import NotFound from './pages/NotFound/NotFound';

export default function App() {{
  return (
    <>
      <ScrollToTop />
      <Header />
      <main className="shell">
        <Routes>
{chr(10).join(routes_components)}
          <Route path="/admin" element={{<AdminDashboard />}} />
          <Route path="*" element={{<NotFound />}} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}}
\"\"\"
    _write_text(project_dir / "frontend" / "src" / "App.jsx", app_jsx)
"""
import re
content = re.sub(r'def _enrich_frontend_with_ai.*?def build_dynamic_site_package', new_enrich + '\ndef build_dynamic_site_package', content, flags=re.DOTALL)
path.write_text(content)
