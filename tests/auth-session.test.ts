import assert from "node:assert/strict";
import test from "node:test";
import { authSessionStore as session } from "../app/ui/auth-session";

// Exercise the production external-store interface. Browser event targets and
// network responses are controlled; the session logic itself is not mocked.
test("the browser session store reconciles network responses and authentication races", async (t) => {
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const storedSignals: string[] = [];
  let timerSequence = 0;
  const fakeWindow = Object.assign(new EventTarget(), {
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerSequence;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
    localStorage: { setItem(_key: string, value: string) { storedSignals.push(value); } },
  });
  const fakeDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const cleanup: (() => void)[] = [];
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
  t.after(() => {
    cleanup.forEach((unsubscribe) => unsubscribe());
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  type Pending = { signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void };
  const requests: Pending[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options: RequestInit) => {
    assert.equal(url, "/api/auth/session");
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    return new Promise<Response>((resolve, reject) => {
      requests.push({ signal: options.signal as AbortSignal, resolve, reject });
    });
  });
  const userA = { id: "account-a", phoneMasked: "***1111", plan: "free" };
  const userB = { id: "account-b", phoneMasked: "***2222", plan: "pro" };
  const response = (user: typeof userA | null, csrfToken = "csrf-for-session") => Response.json({ user, csrfToken });
  let firstNotifications = 0;
  let secondNotifications = 0;
  const unsubscribeFirst = session.subscribe(() => firstNotifications += 1);
  const unsubscribeSecond = session.subscribe(() => secondNotifications += 1);
  cleanup.push(unsubscribeFirst, unsubscribeSecond);

  await t.test("concurrent consumers share one request and receive one verified identity", async () => {
    assert.equal(requests.length, 1);
    const first = session.refresh();
    const second = session.refresh();
    assert.equal(first, second);
    requests[0].resolve(response(userA));
    await first;
    assert.equal(requests.length, 1);
    assert.equal(session.getSnapshot().status, "authenticated");
    assert.deepEqual(session.getSnapshot().user, userA);
    assert.equal(firstNotifications, 1);
    assert.equal(secondNotifications, 1);
    assert.deepEqual(session.getServerSnapshot(), { status: "checking", user: null, csrfToken: "" });
    assert.equal(timers.size, 0);
  });

  await t.test("a server outage or malformed body cannot masquerade as logout", async () => {
    for (const serverResponse of [new Response("Unavailable", { status: 503 }), Response.json({}), new Response("invalid json")]) {
      const refresh = session.refresh();
      requests.at(-1)!.resolve(serverResponse);
      await refresh;
      assert.equal(session.getSnapshot().status, "authenticated");
      assert.deepEqual(session.getSnapshot().user, userA);
      assert.equal(session.getSnapshot().csrfToken, "csrf-for-session");
    }
  });

  await t.test("login cancels an old account check and ignores its late response", async () => {
    const staleRefresh = session.refresh();
    const staleRequest = requests.at(-1)!;
    session.adopt(userB, "csrf-for-b");
    assert.equal(staleRequest.signal.aborted, true);
    staleRequest.resolve(response(userA));
    await staleRefresh;
    assert.deepEqual(session.getSnapshot().user, userB);
    assert.equal(session.getSnapshot().csrfToken, "csrf-for-b");
    const currentRefresh = session.refresh();
    requests.at(-1)!.resolve(response(userB, "csrf-for-b"));
    await currentRefresh;
  });

  await t.test("logout cannot be reversed by a delayed authenticated response", async () => {
    const staleRefresh = session.refresh();
    const staleRequest = requests.at(-1)!;
    session.clear();
    assert.equal(staleRequest.signal.aborted, true);
    staleRequest.resolve(response(userB, "csrf-for-b"));
    await staleRefresh;
    assert.equal(session.getSnapshot().status, "anonymous");
    assert.equal(session.getSnapshot().user, null);
    assert.equal(session.getSnapshot().csrfToken, "");
    const logoutVerification = session.refresh();
    requests.at(-1)!.resolve(response(null));
    await logoutVerification;
  });

  await t.test("other-tab session changes force a check and clear an invalid identity", async () => {
    session.adopt(userB, "csrf-for-b");
    const adoptVerification = session.refresh();
    requests.at(-1)!.resolve(response(userB, "csrf-for-b"));
    await adoptVerification;
    const event = Object.assign(new Event("storage"), { key: "portal-session-change" });
    fakeWindow.dispatchEvent(event);
    const externalCheck = session.refresh();
    requests.at(-1)!.resolve(new Response(null, { status: 401 }));
    await externalCheck;
    assert.equal(session.getSnapshot().status, "anonymous");
    assert.equal(session.getSnapshot().user, null);
    assert.ok(storedSignals.length >= 3);
    for (const value of storedSignals) assert.doesNotMatch(value, /account-|csrf|phoneMasked/);
  });

  await t.test("a timed-out check becomes recoverable and online triggers a new check", async () => {
    const refresh = session.refresh();
    const request = requests.at(-1)!;
    const timeout = Array.from(timers.values()).find((timer) => timer.delay === 12_000);
    assert.ok(timeout);
    timeout.callback();
    assert.equal(request.signal.aborted, true);
    request.reject(new DOMException("Aborted", "AbortError"));
    await refresh;
    assert.equal(session.getSnapshot().status, "unavailable");
    fakeWindow.dispatchEvent(new Event("online"));
    const recovery = session.refresh();
    requests.at(-1)!.resolve(response(userA));
    await recovery;
    assert.equal(session.getSnapshot().status, "authenticated");
  });

  await t.test("returning to a visible document refreshes an aged session", async (subtest) => {
    const now = Date.now();
    subtest.mock.method(Date, "now", () => now + 31_000);
    const count = requests.length;
    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(requests.length, count);
    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(requests.length, count + 1);
    const check = session.refresh();
    requests.at(-1)!.resolve(response(userA));
    await check;
    assert.equal(session.getSnapshot().status, "authenticated");
  });

  await t.test("unmount cancels unused requests and stale completion cannot clear the cached identity", async () => {
    const refresh = session.refresh();
    const request = requests.at(-1)!;
    unsubscribeFirst();
    assert.equal(request.signal.aborted, false);
    unsubscribeSecond();
    assert.equal(request.signal.aborted, true);
    request.resolve(response(null));
    await refresh;
    assert.equal(session.getSnapshot().status, "authenticated");
    assert.deepEqual(session.getSnapshot().user, userA);
    assert.equal(timers.size, 0);
    const count = requests.length;
    fakeWindow.dispatchEvent(new Event("online"));
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(requests.length, count);
    const unsubscribeRemount = session.subscribe(() => {});
    assert.equal(requests.length, count);
    assert.deepEqual(session.getSnapshot().user, userA);
    unsubscribeRemount();
  });
});
