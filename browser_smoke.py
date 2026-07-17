import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        response = await page.goto("http://127.0.0.1:8000/", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        assert response and response.status == 200
        assert await page.locator("#loginOverlay").count() == 1
        assert not errors, errors
        print("Browser smoke: PASS")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
