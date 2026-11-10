export function Placeholder({ route }) {
  return (
    <div className="panel pad placeholder">
      <h2>{route.label}</h2>
      <p>This screen arrives in Sprint {route.sprint}.</p>
    </div>
  );
}

export function Message({ title, text }) {
  return (
    <div className="center-msg">
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}
