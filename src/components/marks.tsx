export function KnicksMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="New York Knicks">
      <circle cx="32" cy="32" r="30" fill="#006BB6" />
      <circle cx="32" cy="32" r="27" fill="none" stroke="#F58426" strokeWidth="2.5" />
      <path d="M32 8c2 6 2 10 0 16M32 40c-2 6-2 10 0 16M8 32c6-2 10-2 16 0M40 32c6 2 10 2 16 0" fill="none" stroke="#F58426" strokeWidth="1.2" opacity="0.7" />
      <text x="32" y="39" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="20" fill="#F58426">
        NY
      </text>
    </svg>
  );
}
