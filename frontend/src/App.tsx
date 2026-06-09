import { useEffect, useState } from "react";
import GraphPage from "./pages/Graph";
import HomePage from "./pages/Home";

type AppRoute = "home" | "graph" | "not-found";

function getRoute(pathname: string): AppRoute {
  if (pathname === "/" || pathname === "") {
    return "home";
  }

  if (pathname === "/graph") {
    return "graph";
  }

  return "not-found";
}

function NotFoundPage() {
  return (
    <main className="tg-home-shell">
      <div className="tg-home-card">
        <a className="tg-home-back-link" href="/">
          Back to home
        </a>
      </div>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() =>
    getRoute(window.location.pathname),
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRoute(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (route === "graph") {
    return <GraphPage />;
  }

  if (route === "home") {
    return <HomePage />;
  }

  return <NotFoundPage />;
}
