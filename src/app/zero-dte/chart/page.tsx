import SpxCommandChart from "../../../components/SpxCommandChart";
import AuthGate from "../../../components/auth/AuthGate";
import { WheelDeskSideNav } from "../../../components/WheelDeskSideNav";

export const dynamic = "force-dynamic";

export default function SpxCommandChartPage() {
  return (
    <AuthGate requiredPlan="research">
    <div
      style={{
        minHeight: "100vh",
        background: "#02070b",
        color: "#eef5fb",
        display: "flex",
      }}
    >
      <WheelDeskSideNav active="zero-dte" />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: "22px",
          overflow: "hidden",
        }}
      >
        <SpxCommandChart />
      </main>
    </div>
    </AuthGate>
  );
}
