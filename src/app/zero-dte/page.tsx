import AuthGate from "../../components/auth/AuthGate";
import ZeroDteCommandClient from "../../components/ZeroDteCommandClient";

export default function ZeroDtePage() {
  return (
    <AuthGate requiredPlan="research">
      <ZeroDteCommandClient />
    </AuthGate>
  );
}
