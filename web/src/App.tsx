import { useRouter } from "./lib/router";
import Landing from "./pages/Landing";
import Console from "./pages/Console";

export default function App() {
  const { path } = useRouter();
  // Everything under /app is the console; anything else lands on the marketing
  // page, so an unknown deep link degrades to something meaningful.
  return path === "/app" || path.startsWith("/app/") ? <Console /> : <Landing />;
}
