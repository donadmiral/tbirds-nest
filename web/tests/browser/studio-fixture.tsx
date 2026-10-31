/** Actual Studio components rendered with isolated synthetic RPC responses. */
import { createRoot } from "react-dom/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StudioShell } from "@/components/StudioShell";
import Overview from "@/app/studio/page";
import Ads from "@/app/studio/ads/page";
import Planner from "@/app/studio/planner/page";
import Newsroom from "@/app/studio/newsroom/page";
import Partnerships from "@/app/studio/partnerships/page";
import Earnings from "@/app/studio/earnings/page";
import Settings from "@/app/studio/settings/page";
import Team from "@/app/studio/team/page";
import Insights from "@/app/studio/insights/page";
import { fixture } from "./studio-backend";

void fixture;
const routes: Record<string, React.ComponentType> = { "/studio": Overview, "/studio/ads": Ads, "/studio/planner": Planner, "/studio/newsroom": Newsroom, "/studio/partnerships": Partnerships, "/studio/earnings": Earnings, "/studio/settings": Settings, "/studio/team": Team, "/studio/settings/organization": Team, "/studio/insights": Insights };
function App() {
  const pathname = usePathname();
  const Page = routes[pathname];
  return <><StudioShell>{Page ? <Page key={pathname}/> : <div><h1>Fixture destination</h1><p>{pathname}</p><p>This destination is outside the Studio component fixture.</p><Link href="/studio">Back to Studio</Link></div>}</StudioShell><div style={{ padding: "5px 14px", font: "10px Arial", letterSpacing: ".03em", textAlign: "center", background: "#edf1f6", color: "#526078", borderTop: "1px solid #d9e0e9" }}>SYNTHETIC BROWSER VERIFICATION · SAMPLE RECORDS · NO LIVE ACCOUNT OR PROVIDER</div></>;
}
createRoot(document.getElementById("root")!).render(<App/>);
