import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  tone?: "default" | "danger";
}

export function IconButton({ label, children, tone = "default", className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${tone === "danger" ? "icon-button--danger" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
