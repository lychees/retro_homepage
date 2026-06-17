from playwright.sync_api import sync_playwright
import requests, json, os, glob

with sync_playwright() as p:
    # submit a work with strokes via API
    strokes = [
        {"id":"s1","from":{"x":50,"y":50},"to":{"x":150,"y":150},"color":"#ff0000","size":4,"alpha":1,"tool":"pen"},
        {"id":"s2","from":{"x":150,"y":150},"to":{"x":250,"y":50},"color":"#00ff00","size":4,"alpha":1,"tool":"pen"}
    ]
    r = requests.post("http://localhost:3000/api/submit", json={
        "type": "oekaki",
        "title": "可回放作品",
        "author": "岛酱",
        "imageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "strokes": strokes,
        "canvas": {"width": 640, "height": 480}
    })
    item_id = r.json()["id"]
    print("submitted", item_id)

    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width":1280,"height":900})
    page.goto("http://localhost:3000/#/gallery", wait_until="domcontentloaded")
    page.wait_for_timeout(800)

    page.locator(".gallery-item").first.click()
    page.wait_for_timeout(300)

    # check buttons visible
    assert page.locator("#gallery-modal-replay").is_visible()
    assert page.locator("#gallery-modal-export").is_visible()

    # click replay
    page.click("#gallery-modal-replay")
    page.wait_for_timeout(500)
    # during replay, canvas should be visible
    assert page.locator("#gallery-replay-canvas").is_visible()

    # click export (downloads file)
    page.click("#gallery-modal-export")
    page.wait_for_timeout(300)

    browser.close()

    # verify detail has strokes
    detail = requests.get(f"http://localhost:3000/api/gallery/{item_id}").json()
    print("detail strokes count", len(detail["strokes"]))
    assert len(detail["strokes"]) == 2
