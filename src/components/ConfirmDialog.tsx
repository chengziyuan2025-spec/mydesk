import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, confirmText = "删除", onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose} width="small">
      <div className="confirm-body">
        <p>{message}</p>
        <div className="form-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>取消</button>
          <button className="button button--danger" type="button" onClick={() => { onConfirm(); onClose(); }}>{confirmText}</button>
        </div>
      </div>
    </Modal>
  );
}
