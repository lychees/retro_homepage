from playwright.sync_api import sync_playwright
import requests, json

with sync_playwright() as p:
    # submit a work via API
    r = requests.post("http://localhost:3000/api/submit", json={
        "type": "oekaki",
        "title": "测试作品",
        "author": "岛酱",
        "imageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    })
    data = r.json()
    item_id = data["id"]
    print("submitted", item_id)

    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width":1280,"height":900})
    page.goto("http://localhost:3000/#/gallery", wait_until="domcontentloaded")
    page.wait_for_timeout(800)

    # open modal
    page.locator(".gallery-item").first.click()
    page.wait_for_timeout(300)

    # like
    page.click("#gallery-modal-like")
    page.wait_for_timeout(300)
    like_count = page.locator("#gallery-modal-like-count").text_content()
    print("like count", like_count)

    # comment
    page.fill("#gallery-comment-author", "访客")
    page.fill("#gallery-comment-text", "画得好棒！")
    page.click("#gallery-comment-submit")
    page.wait_for_timeout(600)

    comments = page.locator("#gallery-modal-comment-list li").all_text_contents()
    print("comments", comments)

    browser.close()

    # verify via API
    detail = requests.get(f"http://localhost:3000/api/gallery/{item_id}").json()
    print("detail likes", detail["likes"], "comments", detail["comments"])
