import React from "react";
import { Button } from "./Button.js";
import { ModalDialog } from "./ModalDialog.js";

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmationDialogProps): React.JSX.Element {
  return (
    <ModalDialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      allowBackdropDismiss={false}
    >
      <div className="flex flex-col gap-4">
        {children}
        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-hairline)]">
          <Button variant="secondary" autoFocus onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
