import { Check, CircleAlert, Info, X } from "lucide-react";
import type { ToastMessage } from "../types";

export function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.type === "success" ? Check : toast.type === "error" ? CircleAlert : Info;
        return (
          <div className={`toast toast--${toast.type}`} key={toast.id}>
            <Icon size={17} strokeWidth={1.8} />
            <span>{toast.message}</span>
            {toast.actionLabel && toast.onAction
              ? <button type="button" onClick={toast.onAction}>{toast.actionLabel}</button>
              : <X size={14} strokeWidth={1.7} aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}
