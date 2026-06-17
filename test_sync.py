from playwright.sync_api import sync_playwright

def test_oekaki_sync(browser):
    p1 = browser.new_page(viewport={'width':1280,'height':900})
    p1.on("console", lambda msg: print("P1 OEKAKI CONSOLE:", msg.type, msg.text))
    p2 = browser.new_page(viewport={'width':1280,'height':900})
    p2.on("console", lambda msg: print("P2 OEKAKI CONSOLE:", msg.type, msg.text))

    p1.goto("http://localhost:3000/#/oekaki", wait_until="domcontentloaded")
    p1.wait_for_timeout(500)
    p1.fill("#oekaki-nick", "A")
    p1.fill("#oekaki-room", "SYNC")
    p1.click("#oekaki-create")
    p1.wait_for_selector("#oekaki-room-view", state="visible", timeout=5000)

    p2.goto("http://localhost:3000/#/oekaki", wait_until="domcontentloaded")
    p2.wait_for_timeout(500)
    p2.fill("#oekaki-nick", "B")
    p2.fill("#oekaki-room", "SYNC")
    p2.click("#oekaki-create")
    p2.wait_for_selector("#oekaki-room-view", state="visible", timeout=10000)
    p2.wait_for_timeout(600)

    # P1 selects red preset
    p1.evaluate("""() => {
        const presets = document.querySelectorAll('#oekaki-draw-tools .color-preset');
        if (presets[2]) presets[2].click();
    }""")
    p1.wait_for_timeout(200)

    # P1 draws red line inside visible canvas
    box = p1.locator("#oekaki-canvas").bounding_box()
    p1.mouse.move(box['x']+box['width']*0.25, box['y']+box['height']*0.25)
    p1.mouse.down()
    p1.mouse.move(box['x']+box['width']*0.55, box['y']+box['height']*0.55)
    p1.mouse.up()
    p1.wait_for_timeout(600)

    # Check P2 canvas has red near center
    has_red = p2.evaluate("""() => {
        const c = document.querySelector('#oekaki-canvas');
        const d = c.getContext('2d').getImageData(320,240,1,1).data;
        return d[0] > 200 && d[1] < 50 && d[2] < 50;
    }""")
    return has_red

def test_pictionary_sync(browser):
    p1 = browser.new_page(viewport={'width':1280,'height':900})
    p1.on("console", lambda msg: print("P1 PICT CONSOLE:", msg.type, msg.text))
    p2 = browser.new_page(viewport={'width':1280,'height':900})
    p2.on("console", lambda msg: print("P2 PICT CONSOLE:", msg.type, msg.text))

    p1.goto("http://localhost:3000/#/pictionary", wait_until="domcontentloaded")
    p1.wait_for_timeout(500)
    p1.fill("#pictionary-nick", "A")
    p1.fill("#pictionary-room", "PSYNC")
    p1.click("#pictionary-create")
    p1.wait_for_selector("#pictionary-room-view", state="visible", timeout=5000)

    p2.goto("http://localhost:3000/#/pictionary?room=PSYNC", wait_until="domcontentloaded")
    p2.wait_for_timeout(500)
    p2.wait_for_selector("#pictionary-room-view", state="visible", timeout=10000)
    p2.wait_for_timeout(600)

    p1.click("#pictionary-start")
    p1.wait_for_timeout(1200)

    # P1 selects red preset
    p1.evaluate("""() => {
        const presets = document.querySelectorAll('#pictionary-draw-tools .color-preset');
        if (presets[2]) presets[2].click();
    }""")
    p1.wait_for_timeout(200)

    # P1 draws red line
    box = p1.locator("#pictionary-canvas").bounding_box()
    p1.mouse.move(box['x']+box['width']*0.25, box['y']+box['height']*0.25)
    p1.mouse.down()
    p1.mouse.move(box['x']+box['width']*0.55, box['y']+box['height']*0.55)
    p1.mouse.up()
    p1.wait_for_timeout(600)

    has_red = p2.evaluate("""() => {
        const c = document.querySelector('#pictionary-canvas');
        const d = c.getContext('2d').getImageData(320,240,1,1).data;
        return d[0] > 200 && d[1] < 50 && d[2] < 50;
    }""")
    return has_red

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    print("Oekaki sync:", test_oekaki_sync(browser))
    print("Pictionary sync:", test_pictionary_sync(browser))
    browser.close()
