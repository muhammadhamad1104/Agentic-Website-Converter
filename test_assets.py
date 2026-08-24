import re
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup

def _normalize_http_url(base_url: str, raw_url: str) -> str | None:
    if not raw_url: return None
    try:
        if raw_url.startswith("data:"): return None
        joined = urljoin(base_url, raw_url)
        parsed = urlparse(joined)
        if parsed.scheme not in {"http", "https"}: return None
        return joined
    except:
        return None

def _collect_page_and_asset_urls(soup, page_url: str):
    asset_urls = set()
    for tag_name, attr_name in [("img", "src"), ("script", "src"), ("link", "href")]:
        for tag in soup.find_all(tag_name):
            raw = str(tag.get(attr_name, "") or "")
            normalized = _normalize_http_url(page_url, raw)
            if normalized:
                asset_urls.add(normalized)
    return asset_urls

import urllib.request
req = urllib.request.Request("https://www.nowwadvisory.co.nz", headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req).read().decode('utf-8')
soup = BeautifulSoup(html, "html.parser")
assets = _collect_page_and_asset_urls(soup, "https://www.nowwadvisory.co.nz")
print("Found assets:", len(assets))
for a in assets: print(a)
