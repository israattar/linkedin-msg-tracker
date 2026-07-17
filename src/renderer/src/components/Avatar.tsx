// Initials avatar with a colour picked deterministically from the name, so a
// contact keeps the same colour everywhere.

const COLOURS = ['#d42a80', '#ff3d9a', '#a5cf2f', '#b04a8f', '#8a9e2f'];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colourOf(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return COLOURS[hash % COLOURS.length];
}

export default function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: colourOf(name),
        fontSize: size * 0.36,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}
