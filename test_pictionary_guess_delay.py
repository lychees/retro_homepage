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

    # P1 is drawer, read the word
    word = p1.locator("#pictionary-word").text_content()
    print("word", word)

    # P2 guesses the word
    p2.fill("#pictionary-guess-input", word)
    p2.click("#pictionary-guess-send")
    p2.wait_for_timeout(500)

    # status should become reveal quickly
    p2.wait_for_function("""() => {
        const el = document.querySelector('#pictionary-status');
        return el && el.textContent.includes('答案');
    }""", timeout=3000)
    print("P2 sees reveal after guess")

    # after ~5s a new turn should start (status changes from reveal to drawing)
    p2.wait_for_function("""() => {
        const el = document.querySelector('#pictionary-status');
        return el && el.textContent.includes('作画');
    }""", timeout=8000)
    print("P2 sees new drawing turn after delay")

    browser.close()
