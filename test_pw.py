import asyncio
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
from test_assets import _collect_page_and_asset_urls

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("https://www.nowwadvisory.co.nz", wait_until="networkidle")
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        assets = _collect_page_and_asset_urls(soup, "https://www.nowwadvisory.co.nz")
        print("Found assets:", len(assets))
        for a in assets: print(a)
        await browser.close()

asyncio.run(main())
