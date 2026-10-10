"use client";

export default function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="primary-button"
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}
