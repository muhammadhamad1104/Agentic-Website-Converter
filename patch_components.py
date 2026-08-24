import sys
from pathlib import Path
import re

path = Path('apps/worker/src/engine/package_builder.py')
content = path.read_text()

# We need to find _enrich_frontend_with_ai and replace it with a more comprehensive version
# that generates shared components and global styles as well.

new_enrich = """def _enrich_frontend_with_ai(project_dir: Path, crawled_pages: dict[str, str], llm: FailoverLLM, brand_name: str) -> None:
    frontend_pages_dir = project_dir / "frontend" / "src" / "pages"
    frontend_components_dir = project_dir / "frontend" / "src" / "components"
    frontend_src_dir = project_dir / "frontend" / "src"
    
    # Extract shared layouts from the first page (usually Home)
    if not crawled_pages:
        return
        
    first_page_url = list(crawled_pages.keys())[0]
    first_page_html = crawled_pages[first_page_url][:8000] # Provide enough content to find headers/footers
    
    # 1. Generate Global Styles
    logging.info("Generating global styles with LLM...")
    global_styles_prompt = f\"\"\"
You are an expert frontend developer. Based on the following HTML of the homepage of {brand_name}, extract all major color themes, typography, and global spacing rules.
Generate a comprehensive `index.css` file for a React app that replicates this design system.

HTML:
```html
{first_page_html}
```

Return ONLY valid CSS code inside a ```css block.
\"\"\"
    try:
        response = llm.invoke(global_styles_prompt)
        match = re.search(r'```css(.*?)```', response, re.DOTALL)
        if match:
            _write_text(frontend_src_dir / "index.css", match.group(1).strip())
            logging.info("Successfully generated global index.css")
    except Exception as e:
        logging.error(f"Failed to generate global styles: {e}")

    # 2. Generate Shared Header
    logging.info("Generating shared Header with LLM...")
    header_prompt = f\"\"\"
You are an expert frontend developer. Extract the navigation/header from the following HTML and convert it into a React JSX component.
Make sure it handles responsive navigation and uses standard <nav> and <header> tags. Use relative links for routing (e.g. <Link to="/">).

Brand Name: {brand_name}
HTML:
```html
{first_page_html}
```

Return a JSON object:
{{
    "jsx": "import React from 'react';\\nimport {{ Link }} from 'react-router-dom';\\nimport './Header.css';\\n\\nexport default function Header() {{ ... }}",
    "css": ".header {{ ... }}"
}}
\"\"\"
    try:
        response = llm.invoke(header_prompt)
        match = re.search(r'\\{.*?\\}', response, re.DOTALL)
        if match:
            data = json.loads(match.group(0))
            header_dir = frontend_components_dir / "Header"
            header_dir.mkdir(parents=True, exist_ok=True)
            _write_text(header_dir / "Header.jsx", data.get("jsx", ""))
            _write_text(header_dir / "Header.css", data.get("css", ""))
            logging.info("Successfully generated shared Header.")
    except Exception as e:
        logging.error(f"Failed to generate Header: {e}")

    # 3. Generate Shared Footer
    logging.info("Generating shared Footer with LLM...")
    footer_prompt = f\"\"\"
You are an expert frontend developer. Extract the footer from the following HTML and convert it into a React JSX component.

Brand Name: {brand_name}
HTML:
```html
{first_page_html}
```

Return a JSON object:
{{
    "jsx": "import React from 'react';\\nimport './Footer.css';\\n\\nexport default function Footer() {{ ... }}",
    "css": ".footer {{ ... }}"
}}
\"\"\"
    try:
        response = llm.invoke(footer_prompt)
        match = re.search(r'\\{.*?\\}', response, re.DOTALL)
        if match:
            data = json.loads(match.group(0))
            footer_dir = frontend_components_dir / "Footer"
            footer_dir.mkdir(parents=True, exist_ok=True)
            _write_text(footer_dir / "Footer.jsx", data.get("jsx", ""))
            _write_text(footer_dir / "Footer.css", data.get("css", ""))
            logging.info("Successfully generated shared Footer.")
    except Exception as e:
        logging.error(f"Failed to generate Footer: {e}")

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
Do NOT include the Header or Footer in this component, just the main page content, as the layout wraps it globally.
Extract and use any images, styling, and structural elements to make it look like a modern, premium design.

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
