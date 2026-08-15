import EsHistoricalFootprintLab from "../../../components/EsHistoricalFootprintLab";
import { WheelDeskSideNav } from "../../../components/WheelDeskSideNav";

export const dynamic = "force-dynamic";

export default function EsHistoryLabPage() {
  return (
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
        <EsHistoricalFootprintLab />
      </main>
    </div>
  );
}
