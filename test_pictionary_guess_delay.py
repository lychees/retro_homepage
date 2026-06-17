from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    p1 = browser.new_page(viewport={"width":1280,"height":900})
    p2 = browser.new_page(viewport={"width":1280,"height":900})

    p1.goto("http://localhost:3000/#/pictionary", wait_until="domcontentloaded")
    p1.wait_for_timeout(500)
    p1.fill("#pictionary-nick", "A")
    p1.fill("#pictionary-room", "GUESS")
    p1.click("#pictionary-create")
    p1.wait_for_selector("#pictionary-room-view", state="visible", timeout=5000)

    p2.goto("http://localhost:3000/#/pictionary?room=GUESS", wait_until="domcontentloaded")
    p2.wait_for_timeout(500)
    p2.wait_for_selector("#pictionary-room-view", state="visible", timeout=10000)
    p2.wait_for_timeout(500)

    p1.click("#pictionary-start")
    p1.wait_for_timeout(1200)

    # P1 draws a black line
    box = p1.locator("#pictionary-canvas").bounding_box()
    p1.mouse.move(box['x']+box['width']*0.3, box['y']+box['height']*0.3)
    p1.mouse.down()
    p1.mouse.move(box['x']+box['width']*0.6, box['y']+box['height']*0.6)
    p1.mouse.up()
    p1.wait_for_timeout(300)

    def p2_has_drawn():
        return p2.evaluate("""() => {
            const c = document.querySelector('#pictionary-canvas');
            const d = c.getContext('2d').getImageData(320,240,1,1).data;
            return d[0] < 50 && d[1] < 50 && d[2] < 50;
        }""")

    assert p2_has_drawn(), "P2 should see the line before guess"
    print("P2 sees line before guess")

    # P1 is drawer, read the word
    word = p1.locator("#pictionary-word").text_content()
    print("word", word)

    # P2 guesses the word
    p2.fill("#pictionary-guess-input", word)
    p2.click("#pictionary-guess-send")

    # status should become reveal quickly
    p2.wait_for_function("""() => {
        const el = document.querySelector('#pictionary-status');
        return el && el.textContent.includes('答案');
    }""", timeout=3000)
    print("P2 sees reveal after guess")

    # canvas should NOT be cleared during reveal
    p2.wait_for_timeout(500)
    assert p2_has_drawn(), "Canvas should remain visible during reveal"
    print("P2 canvas still visible during reveal")

    # after ~5s a new turn should start (status changes from reveal to drawing)
    p2.wait_for_function("""() => {
        const el = document.querySelector('#pictionary-status');
        return el && el.textContent.includes('作画');
    }""", timeout=8000)
    print("P2 sees new drawing turn after delay")

    # canvas should be cleared at the start of new turn
    p2.wait_for_timeout(300)
    assert not p2_has_drawn(), "Canvas should be cleared when new turn starts"
    print("P2 canvas cleared on new turn")

    browser.close()
