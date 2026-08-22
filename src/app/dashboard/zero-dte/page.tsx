import AuthGate from "../../../components/auth/AuthGate";
import ZeroDteCommandClient from "../../../components/ZeroDteCommandClient";

export default function DashboardZeroDtePage() {
  return (
    <AuthGate requiredPlan="research">
      <ZeroDteCommandClient />
    </AuthGate>
  );
}
