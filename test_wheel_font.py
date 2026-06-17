from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width":1280,"height":900})
    page.goto("http://localhost:3000/#/oekaki", wait_until="domcontentloaded")
    page.wait_for_timeout(500)
    page.fill("#oekaki-nick", "A")
    page.fill("#oekaki-room", "WF")
    page.click("#oekaki-create")
    page.wait_for_selector("#oekaki-room-view", state="visible", timeout=5000)
    page.wait_for_timeout(500)

    # wheel on rgba-r
    page.click("#oekaki-draw-tools .rgba-r")
    page.wait_for_timeout(100)
    before = page.input_value("#oekaki-draw-tools .rgba-r")
    page.locator("#oekaki-draw-tools .rgba-r").hover()
    page.mouse.wheel(0, -3)
    page.wait_for_timeout(200)
    after = page.input_value("#oekaki-draw-tools .rgba-r")
    print("rgba-r before/after wheel", before, after)
    assert int(after) > int(before)

    # wheel on brush-size-input
    page.click("#oekaki-draw-tools .brush-size-input")
    page.wait_for_timeout(100)
    before = page.input_value("#oekaki-draw-tools .brush-size-input")
    page.locator("#oekaki-draw-tools .brush-size-input").hover()
    page.mouse.wheel(0, 3)
    page.wait_for_timeout(200)
    after = page.input_value("#oekaki-draw-tools .brush-size-input")
    print("brush-size before/after wheel", before, after)
    assert int(after) < int(before)

    # select text tool and font
    page.click('[data-tool="text"]')
    page.wait_for_timeout(200)
    page.select_option("#oekaki-draw-tools .font-select", "cursive")
    selected = page.input_value("#oekaki-draw-tools .font-select")
    print("selected font", selected)
    assert selected == "cursive"

    browser.close()
