import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { addMember, createTrip, startServer } from "./support/server.mjs";

function chromeBinary() {
  for (const binary of [process.env.CHROME_BIN, "google-chrome", "chromium", "chromium-browser"].filter(Boolean)) {
    if (spawnSync(binary, ["--version"], { stdio: "ignore" }).status === 0) return binary;
  }
  throw new Error("Chrome or Chromium is required for the browser test. Set CHROME_BIN to its executable path.");
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function browserFor(fixture, profile = "chrome") {
  const port = await freePort();
  const child = spawn(chromeBinary(), [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(fixture.directory, profile)}`,
    "--window-size=1280,900", "about:blank",
  ], { stdio: "ignore" });
  let pages;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) { pages = await response.json(); break; }
    } catch { /* Wait for Chrome. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!pages) { child.kill("SIGTERM"); throw new Error("Headless Chrome did not start"); }
  const page = pages.find((item) => item.type === "page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const result = JSON.parse(data);
    if (!result.id || !pending.has(result.id)) return;
    const { resolve, reject } = pending.get(result.id);
    pending.delete(result.id);
    result.error ? reject(new Error(result.error.message)) : resolve(result.result);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label, attempts = 80) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { if (await evaluate(expression)) return; } catch { /* Navigation may still be in progress. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const state = await evaluate("JSON.stringify({ url: location.href, text: document.body?.innerText.slice(0, 1200) })").catch(() => "Page state unavailable");
    throw new Error(`Timed out waiting for ${label}. ${state}`);
  };
  await command("Page.enable");
  await command("Runtime.enable");
  return {
    command, evaluate, until,
    async close() {
      socket.close();
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
}

async function setField(browser, selector, value) {
  await browser.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (!field) throw new Error(${JSON.stringify(`Missing field: ${selector}`)});
    if (field instanceof HTMLSelectElement) {
      field.value = ${JSON.stringify(value)};
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
}

async function clickTab(browser, name) {
  await browser.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.tabs .tab')].find(node => node.textContent.includes(${JSON.stringify(name)}));
    if (!tab) throw new Error('Missing tab: ${name}');
    tab.click();
  })()`);
}

test("existing member can sign in, chat, refresh, and see online presence", async () => {
  const fixture = await startServer();
  let browser;
  try {
    const trip = await createTrip(fixture.request);
    await addMember(fixture.request, trip.code, "Ben");
    browser = await browserFor(fixture);
    await browser.command("Page.navigate", { url: `${fixture.baseUrl}/join?code=${trip.code}&mode=login` });
    await browser.until("Boolean(document.querySelector('#member-pin'))", "member sign-in form");
    await browser.evaluate(`(() => {
      const set = (selector, value) => {
        const field = document.querySelector(selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#name', 'Ben'); set('#member-pin', '5678');
      document.querySelector('form button[type=submit]').click();
    })()`);
    await browser.until(`location.pathname === '/trip/${trip.code}' && document.body.textContent.includes('Viewing as')`, "signed-in dashboard");
    assert.equal(await browser.evaluate("document.body.textContent.includes('Viewing as Ben')"), true);
    await browser.evaluate("document.querySelector('.chat-tab').click()");
    await browser.until("Boolean(document.querySelector('#chat-text'))", "chat composer");
    await browser.until("document.querySelector('.online-count')?.textContent === '1'", "online roster");
    await browser.evaluate(`(async () => {
      const field = document.querySelector('#chat-text');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Ready for the trip');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 50));
      document.querySelector('.chat-compose button').click();
    })()`);
    await browser.until("[...document.querySelectorAll('.chat-message p')].some(node => node.textContent === 'Ready for the trip')", "sent chat message");
    await browser.command("Page.reload");
    await browser.until("Boolean(document.querySelector('.chat-tab'))", "dashboard after reload");
    await browser.evaluate("document.querySelector('.chat-tab').click()");
    await browser.until("[...document.querySelectorAll('.chat-message p')].some(node => node.textContent === 'Ready for the trip')", "saved chat history");
    assert.equal(await browser.evaluate("document.body.textContent.includes('API route not found')"), false);
  } finally {
    await browser?.close();
    await fixture.close();
  }
});

test("trip sections stay visible and tappable at phone, tablet, and desktop widths", async () => {
  const fixture = await startServer();
  let browser;
  try {
    const trip = await createTrip(fixture.request);
    browser = await browserFor(fixture, "chrome-responsive-tabs");
    await browser.command("Page.navigate", { url: `${fixture.baseUrl}/trip/${trip.code}` });
    await browser.until("document.querySelectorAll('.tabs .tab').length === 7", "trip sections");

    for (const width of [320, 390, 768, 1280]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 768 });
      const layout = await browser.evaluate(`(() => {
        const nav = document.querySelector('.dashboard-page .tabs');
        const bounds = nav.getBoundingClientRect();
        return {
          scrollWidth: nav.scrollWidth,
          clientWidth: nav.clientWidth,
          buttons: [...nav.querySelectorAll('.tab')].map(button => {
            const rect = button.getBoundingClientRect();
            return { label: button.textContent.trim(), left: rect.left, right: rect.right, height: rect.height };
          }),
          left: bounds.left,
          right: bounds.right,
        };
      })()`);
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${width}px: section navigation overflows`);
      for (const button of layout.buttons) {
        assert.ok(button.left >= layout.left - 1 && button.right <= layout.right + 1, `${width}px: ${button.label} is clipped`);
        assert.ok(button.height >= 44, `${width}px: ${button.label} tap target is too short`);
      }
      await browser.evaluate("document.querySelector('.chat-tab').click()");
      await browser.until("document.querySelector('.chat-tab')?.getAttribute('aria-pressed') === 'true'", `${width}px chat selection`);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.trip-chat'))"), true, `${width}px: chat is unavailable`);
    }
  } finally {
    await browser?.close();
    await fixture.close();
  }
});

test("two signed-in members establish a WebRTC data channel", async () => {
  const fixture = await startServer();
  let adaBrowser;
  let benBrowser;
  try {
    const trip = await createTrip(fixture.request);
    const ben = await addMember(fixture.request, trip.code, "Ben");
    adaBrowser = await browserFor(fixture, "chrome-ada");
    benBrowser = await browserFor(fixture, "chrome-ben");
    async function openAs(browser, token) {
      await browser.command("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('yolo:${trip.code}:token', '${token}')` });
      await browser.command("Page.navigate", { url: `${fixture.baseUrl}/trip/${trip.code}?tab=chat` });
      await browser.until("Boolean(document.querySelector('#chat-text'))", "signed-in chat");
    }
    await Promise.all([
      openAs(adaBrowser, trip.creatorToken),
      openAs(benBrowser, ben.token),
    ]);
    const connected = "document.querySelector('.chat-connection')?.textContent.includes('Direct connection')";
    await Promise.all([
      adaBrowser.until(connected, "Ada's WebRTC data channel", 150),
      benBrowser.until(connected, "Ben's WebRTC data channel", 150),
    ]);
    assert.equal(await adaBrowser.evaluate("document.querySelector('.online-count')?.textContent"), "2");
    assert.equal(await benBrowser.evaluate("document.querySelector('.online-count')?.textContent"), "2");
  } finally {
    await adaBrowser?.close();
    await benBrowser?.close();
    await fixture.close();
  }
});

test("creator can manage a trip through the dashboard and complete it", async () => {
  const fixture = await startServer();
  let browser;
  try {
    browser = await browserFor(fixture, "chrome-workflow");
    await browser.command("Page.navigate", { url: `${fixture.baseUrl}/create` });
    await browser.until("Boolean(document.querySelector('#creator-pin'))", "create trip form");
    await setField(browser, "#name", "Coastal Weekend");
    await setField(browser, "#creator", "Ada");
    await setField(browser, "#creator-pin", "1234");
    await setField(browser, "#amount", "100");
    await browser.evaluate("document.querySelector('form button[type=submit]').click()");
    await browser.until("location.pathname.startsWith('/trip/') && Boolean(document.querySelector('.trip-hero'))", "created trip dashboard");
    const code = await browser.evaluate("location.pathname.split('/').at(-1)");
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(await browser.evaluate("document.body.textContent.includes('Coastal Weekend')"), true);

    await clickTab(browser, "Members");
    await browser.until("Boolean(document.querySelector('.leader-request-button'))", "member and leader controls");
    await browser.evaluate("document.querySelector('.leader-request-button').click()");
    await browser.until("Boolean(document.querySelector('.leader-vote-button'))", "leader ballot");
    await browser.evaluate("document.querySelector('.leader-vote-button').click()");
    await browser.until("document.querySelector('.current-leader')?.textContent.includes('Ada')", "elected leader");
    await setField(browser, ".actions-row input[placeholder='Member name']", "Ben");
    await setField(browser, ".actions-row input[aria-label='Temporary 4-digit PIN']", "5678");
    await browser.evaluate("document.querySelector('.actions-row button[type=submit]').click()");
    await browser.until("[...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('Ben'))", "new member");

    await clickTab(browser, "Categories");
    await browser.until("Boolean(document.querySelector('#new-category'))", "category form");
    await setField(browser, "#new-category", "Gear");
    await browser.evaluate("document.querySelector('.category-add button[type=submit]').click()");
    await browser.until("[...document.querySelectorAll('.category-item')].some(item => item.textContent.includes('Gear'))", "custom category");

    await clickTab(browser, "Contributions");
    await browser.until("document.querySelector('.card form select')?.options.length > 1", "contribution form");
    const memberValue = await browser.evaluate("document.querySelector('.card form select').options[1].value");
    await setField(browser, ".card form select", memberValue);
    await setField(browser, ".card form input[type=number]", "100");
    await browser.evaluate("document.querySelector('.card form button[type=submit]').click()");
    await browser.until("[...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('100'))", "contribution row");

    await clickTab(browser, "Expenses");
    await browser.until("Boolean(document.querySelector('.card form input[placeholder]'))", "expense form");
    await setField(browser, ".card form input[placeholder]", "Rain jackets");
    await setField(browser, ".card form input[type=number]", "25");
    await setField(browser, ".card form select:nth-of-type(1)", "Gear");
    await browser.until("!document.querySelector('.expense-composer button[type=submit]').disabled", "expense form ready");
    await browser.evaluate("document.querySelector('.card form button[type=submit]').click()");
    await browser.until("[...document.querySelectorAll('.expense-entry')].some(row => row.textContent.includes('Rain jackets'))", "expense row");

    await clickTab(browser, "Notes");
    await browser.until("Boolean(document.querySelector('#note-content'))", "note composer");
    await setField(browser, "#note-content", "Pack light");
    await browser.evaluate("document.querySelector('.notes-composer button[type=submit]').click()");
    await browser.until("[...document.querySelectorAll('.sticky-content')].some(node => node.textContent.includes('Pack light'))", "saved note");

    await clickTab(browser, "Breakdown");
    await browser.until("Boolean(document.querySelector('.completion-card button'))", "completion vote");
    await browser.evaluate("document.querySelector('.completion-card button').click()");
    await browser.until("Boolean(document.querySelector('.completion-card a[href$=\"report.pdf\"]'))", "completed report link");
    const completion = await fixture.request(`/trips/${code}/completion`);
    assert.equal(completion.body.completed, true);
  } finally {
    await browser?.close();
    await fixture.close();
  }
});

test("split expense payments update contribution progress and spending charts", async () => {
  const fixture = await startServer();
  let browser;
  try {
    const trip = await createTrip(fixture.request);
    await addMember(fixture.request, trip.code, "Ben");
    await addMember(fixture.request, trip.code, "Cara", "2468");
    const path = `/trips/${trip.code}`;
    await fixture.request(path + "/contributions", { method: "POST", token: trip.creatorToken, json: { memberId: trip.creatorMemberId, amount: 40 } });
    browser = await browserFor(fixture, "chrome-expense-credit");
    await browser.command("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('yolo:${trip.code}:token', '${trip.creatorToken}')` });
    await browser.command("Page.navigate", { url: fixture.baseUrl + `/trip/${trip.code}` });
    await browser.until("document.body.textContent.includes('Viewing as Ada')", "signed-in dashboard");
    await clickTab(browser, "Expenses");
    await browser.until("Boolean(document.querySelector('#expense-description'))", "expense composer");
    await setField(browser, "#expense-description", "Dinner with friends");
    await setField(browser, "#expense-amount", "100");
    await setField(browser, "#expense-category", "Food");
    await setField(browser, "#expense-source", "members");
    await browser.until("document.querySelectorAll('.expense-split').length === 2", "payer and beneficiary pickers");
    await browser.evaluate("document.querySelector('.expense-split input[type=checkbox]').click()");
    await browser.until("document.querySelector('.expense-split .split-toolbar span')?.textContent.includes('1 of')", "first payer selected");
    await browser.evaluate("document.querySelectorAll('.expense-split:first-child input[type=checkbox]')[1].click()");
    await browser.until("document.querySelector('.expense-split .split-toolbar span')?.textContent.includes('2 of')", "second payer selected");
    await browser.evaluate("[...document.querySelector('.expense-split').querySelectorAll('.split-methods button')].find(button => button.textContent === 'Exact amounts').click()");
    await browser.until("document.querySelectorAll('.expense-split:first-child input[type=number]').length === 2", "exact payer amounts");
    await setField(browser, ".expense-split:first-child .split-member:nth-child(1) input[type=number]", "60");
    await setField(browser, ".expense-split:first-child .split-member:nth-child(2) input[type=number]", "40");
    await browser.until("!document.querySelector('.expense-composer button[type=submit]').disabled", "valid expense split");
    await browser.evaluate("document.querySelector('.expense-composer button[type=submit]').click()");
    await browser.until("document.querySelector('.expense-entry')?.textContent.includes('Dinner with friends')", "saved split expense");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.spending-chart-row-heading strong')].map(node => node.textContent)"), ["LKR 60.00", "LKR 40.00"]);
    for (const [label, expected] of [["Categories", "Food"], ["Largest expenses", "Dinner with friends"], ["Who paid most", "Ada"]]) {
      await browser.evaluate(`[...document.querySelectorAll('.spending-chart-tabs button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
      await browser.until(`document.querySelector('.spending-chart-bars')?.textContent.includes(${JSON.stringify(expected)})`, label + " chart");
    }
    for (const width of [320, 390, 1280]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 640 });
      assert.ok(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), `${width}px expense page overflows`);
      if (process.env.UI_QA_DIR && width !== 320) {
        const screenshot = await browser.command("Page.captureScreenshot", { captureBeyondViewport: true });
        writeFileSync(`${process.env.UI_QA_DIR}/expense-chart-${width}.png`, Buffer.from(screenshot.data, "base64"));
      }
    }
    await clickTab(browser, "Contributions");
    await browser.until("document.querySelector('.contribution-progress')?.textContent.includes('Target met')", "direct payment target credit");
    const progress = await browser.evaluate("[...document.querySelectorAll('.contribution-member')].map(node => node.textContent)");
    assert.match(progress[0], /Ada.*100\.00.*Target met/s);
    assert.match(progress[0], /Into pot: 40\.00.*Paid directly: 60\.00/s);
    assert.match(progress[1], /Ben.*40\.00.*Remaining 60\.00/s);
    assert.match(progress[2], /Cara.*0\.00.*Remaining 100\.00/s);
    assert.equal(await browser.evaluate("document.querySelectorAll('tbody tr').length"), 1);
    await clickTab(browser, "Breakdown");
    await browser.until("document.querySelector('.contribution-progress')?.textContent.includes('Target met')", "breakdown target credit");
    assert.equal(await browser.evaluate("document.querySelector('.stat .value').textContent"), "LKR 140");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.settlement-scroll tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))"), [
      ["Ada", "60", "33.34", "66.66"], ["Ben", "40", "33.33", "6.67"], ["Cara", "0", "33.33", "-33.33"],
    ]);
    await clickTab(browser, "Expenses");
    await browser.until("Boolean(document.querySelector('.expense-remove'))", "expense removal button");
    await browser.evaluate("window.confirm = () => true; document.querySelector('.expense-remove').click()");
    await browser.until("document.querySelector('.expense-spending-chart .empty-state')?.textContent.includes('Add an expense')", "chart after removal");
    await clickTab(browser, "Contributions");
    await browser.until("document.querySelector('.contribution-progress')?.textContent.includes('Remaining 60.00')", "target credit reversal");
    const remaining = await browser.evaluate("[...document.querySelectorAll('.contribution-member')].map(node => node.textContent)");
    assert.match(remaining[0], /Ada.*40\.00.*Remaining 60\.00/s);
    assert.match(remaining[1], /Ben.*0\.00.*Remaining 100\.00/s);
    await clickTab(browser, "Breakdown");
    await browser.until("document.querySelector('.settlement-scroll tbody tr')?.textContent.includes('Ada')", "breakdown after removal");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.settlement-scroll tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))"), [
      ["Ada", "0", "0", "40"], ["Ben", "0", "0", "0"], ["Cara", "0", "0", "0"],
    ]);
  } finally {
    await browser?.close();
    await fixture.close();
  }
});
