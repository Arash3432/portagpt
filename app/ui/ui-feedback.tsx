"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { FormEvent, RefObject, useEffect, useId, useRef } from "react";
import { type Locale, tr } from "./i18n";

export type UiNotice = { text: string; tone?: "success" | "error" | "info" } | null;

export function ToastNotice({
  notice,
  onClose,
  locale = "fa",
}: {
  notice: UiNotice;
  onClose: () => void;
  locale?: Locale;
}) {
  const closeLabel = tr(locale).common.close;
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => closeRef.current(), notice.tone === "error" ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  const Icon = notice.tone === "error" ? AlertTriangle : notice.tone === "success" ? CheckCircle2 : Info;
  return (
    <div className={`ui-toast is-${notice.tone || "info"}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"} aria-atomic="true">
      <span><Icon size={19} /></span>
      <p>{notice.text}</p>
      <button type="button" onClick={onClose} aria-label={closeLabel}><X size={17} /></button>
      <i />
    </div>
  );
}

type DialogEntry = { ref: RefObject<HTMLElement | null>; previousFocus: HTMLElement | null };
const dialogStack: DialogEntry[] = [];
let bodyOverflowBeforeDialogs = "";
const focusableSelector = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) =>
    element.tabIndex >= 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden",
  );
}

function focusDialog(dialog: HTMLElement) {
  const elements = focusableElements(dialog);
  const preferred = elements.find((element) => element.hasAttribute("data-dialog-autofocus"));
  (preferred || elements[0] || dialog).focus({ preventScroll: true });
}

export function useDialogFocus(open: boolean, dialogRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const entry: DialogEntry = {
      ref: dialogRef,
      previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    if (!dialogStack.length) {
      bodyOverflowBeforeDialogs = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogStack.push(entry);
    const dialog = dialogRef.current;
    const oldTabIndex = dialog?.getAttribute("tabindex") ?? null;
    if (dialog && oldTabIndex === null) dialog.setAttribute("tabindex", "-1");
    const isTopDialog = () => dialogStack[dialogStack.length - 1] === entry;
    const focusFirst = window.requestAnimationFrame(() => {
      if (isTopDialog() && dialogRef.current) focusDialog(dialogRef.current);
    });
    const onKey = (event: KeyboardEvent) => {
      if (!isTopDialog() || event.defaultPrevented) return;
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const currentDialog = dialogRef.current;
      const focusable = focusableElements(currentDialog);
      if (!focusable.length) {
        event.preventDefault();
        currentDialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!currentDialog.contains(active) || active === currentDialog || !focusable.includes(active as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      const currentDialog = dialogRef.current;
      if (isTopDialog() && currentDialog && event.target instanceof Node && !currentDialog.contains(event.target)) {
        focusDialog(currentDialog);
      }
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      const wasTop = isTopDialog();
      const index = dialogStack.indexOf(entry);
      if (index !== -1) dialogStack.splice(index, 1);
      if (dialog && oldTabIndex === null) dialog.removeAttribute("tabindex");
      if (!dialogStack.length) document.body.style.overflow = bodyOverflowBeforeDialogs;
      if (wasTop) {
        const parentDialog = dialogStack[dialogStack.length - 1]?.ref.current;
        const previousFocus = entry.previousFocus;
        if (previousFocus?.isConnected && (!parentDialog || parentDialog.contains(previousFocus))) {
          previousFocus.focus({ preventScroll: true });
        } else if (parentDialog) {
          focusDialog(parentDialog);
        }
      }
    };
  }, [dialogRef, open]);
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  locale = "fa",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  locale?: Locale;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelText = cancelLabel ?? tr(locale).common.cancel;
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useDialogFocus(open, dialogRef, onClose);
  if (!open) return null;
  return (
    <div className="ui-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      <button type="button" className="ui-confirm-scrim" onClick={onClose} aria-label={cancelText} tabIndex={-1} aria-hidden="true" />
      <div className="ui-confirm-card" ref={dialogRef}>
        <span className={danger ? "is-danger" : ""}><AlertTriangle size={23} /></span>
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{body}</p>
        <div>
          <button type="button" className="public-secondary" onClick={onClose}>{cancelText}</button>
          <button type="button" className={danger ? "ui-danger-button" : "public-primary"} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function TextInputDialog({
  open,
  title,
  body,
  value,
  placeholder,
  confirmLabel,
  cancelLabel,
  maxLength = 1000,
  locale = "fa",
  onChange,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  value: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel?: string;
  maxLength?: number;
  locale?: Locale;
  onChange: (value: string) => void;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const t = tr(locale);
  const cancelText = cancelLabel ?? t.common.cancel;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useDialogFocus(open, dialogRef, onClose);
  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = value.trim();
    if (cleaned) onConfirm(cleaned);
  };
  return (
    <div className="ui-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      <button type="button" className="ui-confirm-scrim" onClick={onClose} aria-label={cancelText} tabIndex={-1} aria-hidden="true" />
      <div className="ui-confirm-card ui-input-dialog" ref={dialogRef}>
        <span><Info size={23} /></span>
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{body}</p>
        <form className="ui-input-dialog-form" onSubmit={submit}>
          <textarea
            ref={inputRef}
            data-dialog-autofocus
            value={value}
            onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
            maxLength={maxLength}
            placeholder={placeholder}
            required
            aria-label={title}
          />
          <small>{value.length.toLocaleString(t && locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : locale === "zh" ? "zh-CN" : "en-US")} / {maxLength.toLocaleString(locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : locale === "zh" ? "zh-CN" : "en-US")}</small>
          <div>
            <button type="button" className="public-secondary" onClick={onClose}>{cancelText}</button>
            <button type="submit" className="public-primary" disabled={!value.trim()}>{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
