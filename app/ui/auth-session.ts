"use client";

import { useSyncExternalStore } from "react";
import type { AuthSessionUser } from "./auth-dialog";

export type AuthStatus = "checking" | "authenticated" | "anonymous" | "unavailable";

export type AuthSnapshot = {
  status: AuthStatus;
  user: AuthSessionUser | null;
  csrfToken: string;
};

const SESSION_CHANGE_EVENT = "portal:session-change";
const SESSION_CHANGE_STORAGE_KEY = "portal-session-change";
const SESSION_TIMEOUT_MS = 12_000;
const SESSION_REFRESH_INTERVAL_MS = 30_000;
const initialSnapshot: AuthSnapshot = { status: "checking", user: null, csrfToken: "" };

// A browser-memory cache survives client-side navigation. No identity or CSRF
// token is written to persistent storage; the server remains authoritative.
let snapshot: AuthSnapshot = initialSnapshot;
let requestVersion = 0;
let lastVerifiedAt = 0;
let inFlight: { controller: AbortController; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function publish(next: AuthSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function invalidateRequest() {
  requestVersion += 1;
  inFlight?.controller.abort();
  inFlight = null;
}

function markUnavailable() {
  // A connection failure is not proof of logout. Keep the verified identity
  // while protected API routes continue checking the actual server session.
  if (!snapshot.user) publish({ ...snapshot, status: "unavailable" });
}

function refresh(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inFlight) return inFlight.promise;

  const version = ++requestVersion;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  const promise = (async () => {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (version !== requestVersion) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          lastVerifiedAt = Date.now();
          publish({ status: "anonymous", user: null, csrfToken: "" });
        } else {
          markUnavailable();
        }
        return;
      }

      const body: unknown = await response.json();
      if (version !== requestVersion) return;
      if (!body || typeof body !== "object" || !("user" in body)) throw new Error("INVALID_SESSION_RESPONSE");
      if (body.user === null) {
        lastVerifiedAt = Date.now();
        publish({ status: "anonymous", user: null, csrfToken: "" });
        return;
      }
      const user = body.user as AuthSessionUser | undefined;
      const csrfToken = "csrfToken" in body ? body.csrfToken : null;
      if (!user || typeof user.id !== "string" || !user.id || typeof user.plan !== "string" || typeof user.phoneMasked !== "string" || typeof csrfToken !== "string" || !csrfToken) {
        throw new Error("INVALID_SESSION_RESPONSE");
      }
      lastVerifiedAt = Date.now();
      publish({ status: "authenticated", user, csrfToken });
    } catch {
      if (version === requestVersion) markUnavailable();
    } finally {
      window.clearTimeout(timeout);
      if (version === requestVersion) inFlight = null;
    }
  })();
  inFlight = { controller, promise };
  return promise;
}

export function notifyAuthSessionChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
  try {
    // A nonce, never session data, notifies other tabs even within the same ms.
    window.localStorage.setItem(SESSION_CHANGE_STORAGE_KEY, `${Date.now()}:${Math.random().toString(36).slice(2)}`);
  } catch {
    // Private browsing can deny storage access; the in-tab event is enough.
  }
}

function adopt(user: AuthSessionUser, csrfToken: string) {
  invalidateRequest();
  lastVerifiedAt = Date.now();
  publish({ status: "authenticated", user, csrfToken });
  notifyAuthSessionChange();
}

function clear() {
  invalidateRequest();
  lastVerifiedAt = Date.now();
  publish({ status: "anonymous", user: null, csrfToken: "" });
  notifyAuthSessionChange();
}

function onSessionChange() {
  invalidateRequest();
  void refresh();
}

function onStorage(event: StorageEvent) {
  if (event.key === SESSION_CHANGE_STORAGE_KEY) onSessionChange();
}

function onVisible() {
  if (document.visibilityState === "visible" && Date.now() - lastVerifiedAt >= SESSION_REFRESH_INTERVAL_MS) void refresh();
}

function onOnline() {
  void refresh();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    if (snapshot.status === "checking" || snapshot.status === "unavailable" || Date.now() - lastVerifiedAt >= SESSION_REFRESH_INTERVAL_MS) void refresh();
  }
  return () => {
    if (!listeners.delete(listener)) return;
    if (!listeners.size) {
      window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      invalidateRequest();
    }
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return initialSnapshot;
}

// The subscription interface also supports non-React consumers and regression
// tests without duplicating the session transition logic.
export const authSessionStore = { subscribe, getSnapshot, getServerSnapshot, refresh, adopt, clear };

export function useAuthSession() {
  const current = useSyncExternalStore(authSessionStore.subscribe, authSessionStore.getSnapshot, authSessionStore.getServerSnapshot);
  return { ...current, refresh, adopt, clear };
}
