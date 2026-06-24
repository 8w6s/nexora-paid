import type React from "react";
import { Modal } from "./Modal";

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
}) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {cancelText}
          </button>
          <button
            className="btn"
            style={danger ? { background: "var(--price)", borderColor: "var(--price)" } : {}}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p style={{ fontSize: ".88rem", color: "var(--ink-soft)", lineHeight: 1.5 }}>{message}</p>
    </Modal>
  );
};
