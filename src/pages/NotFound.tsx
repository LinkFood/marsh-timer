import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <p className="mb-2 text-6xl">404</p>
      <h1 className="mb-3 font-display text-3xl font-bold text-amber-400 sm:text-4xl">
        This Duck Flew Away
      </h1>
      <p className="mb-8 max-w-md font-body text-lg text-muted-foreground">
        Nothing at <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm">{location.pathname}</code>.
        Might have migrated south for the winter.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-amber-400 px-6 py-3 font-body font-semibold text-background transition-colors hover:bg-amber-300"
      >
        Back to the Blind
      </Link>
    </div>
  );
};

export default NotFound;
