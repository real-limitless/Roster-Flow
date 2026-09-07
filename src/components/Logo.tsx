import { Link } from "react-router-dom";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark" aria-hidden />
      <span className="brand-name">
        roster<span>-flow</span>
      </span>
    </Link>
  );
}
