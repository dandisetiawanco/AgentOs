import React, { useEffect, useId, useRef } from "react";

export interface ModalDialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  allowBackdropDismiss?: boolean;
}

/**
 * Native <dialog> modal following modern-web-guidance:
 * opens with showModal(), omits redundant ARIA modal attributes, resets returnValue on close,
 * and falls back to geometry-based backdrop dismissal where closedby is unsupported.
 */
export function ModalDialog({
  open,
  title,
  description,
  onClose,
  children,
  allowBackdropDismiss = true,
}: ModalDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    let pressedOutside = false;
    const isOutside = (event: PointerEvent): boolean => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (allowBackdropDismiss) {
        pressedOutside = isOutside(event);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (allowBackdropDismiss && pressedOutside && isOutside(event)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    const supportsClosedBy = "closedBy" in HTMLDialogElement.prototype;
    if (!supportsClosedBy && allowBackdropDismiss) {
      dialog.addEventListener("pointerdown", handlePointerDown);
      dialog.addEventListener("pointerup", handlePointerUp);
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      if (!supportsClosedBy && allowBackdropDismiss) {
        dialog.removeEventListener("pointerdown", handlePointerDown);
        dialog.removeEventListener("pointerup", handlePointerUp);
      }
    };
  }, [allowBackdropDismiss, onClose]);

  const closedByProp = {
    closedby: allowBackdropDismiss ? "any" : "closerequest",
  } as Record<string, string>;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className="agentos-dialog w-[min(92vw,540px)] rounded-[10px] border border-[var(--border-control)] bg-[var(--surface-elevated)] text-[var(--ink-primary)] p-0 shadow-lg"
      {...closedByProp}
    >
      <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="text-[16px] font-semibold leading-snug">
            {title}
          </h2>
          {description && (
            <p id={descId} className="text-[13px] text-[var(--ink-secondary)] mt-1">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
          className="rounded-[6px] px-2 py-1 text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--surface-recessed)] hover:text-[var(--ink-primary)]"
        >
          Close
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
