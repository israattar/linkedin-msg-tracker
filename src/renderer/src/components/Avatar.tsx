// Initials avatar with a colour picked deterministically from the name, so a
// contact keeps the same colour everywhere. Four limes to one pink: enough
// pink to keep a list from reading monochrome, rare enough that it stays a
// grace note rather than a signal.

const COLOURS: { bg: string; ink: string }[] = [
  { bg: '#a3bb2b', ink: '#1f2604' },
  { bg: '#6f8414', ink: '#f2f7df' },
  { bg: '#55651a', ink: '#d7e88a' },
  { bg: '#87a022', ink: '#141a03' },
  { bg: '#ec1b7c', ink: '#ffffff' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colourOf(name: string): { bg: string; ink: string } {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return COLOURS[hash % COLOURS.length];
}

export default function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const colour = colourOf(name);
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: colour.bg,
        color: colour.ink,
        fontSize: size * 0.36,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}
