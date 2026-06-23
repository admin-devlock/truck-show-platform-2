/* Circular avatar — uses the Google photo when available, else a coloured initial. */
export function Avatar({
  name,
  photo,
  color = "#5f6368",
  size = 32,
  ring = false,
}: {
  name: string;
  photo?: string | null;
  color?: string;
  size?: number;
  ring?: boolean;
}) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.42,
    boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : undefined,
  };
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={photo}
        alt={name}
        style={style}
        className="rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      style={{ ...style, background: color }}
      className="rounded-full flex items-center justify-center font-medium text-white select-none"
      title={name}
    >
      {initial}
    </div>
  );
}
