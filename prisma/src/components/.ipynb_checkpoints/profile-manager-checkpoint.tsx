import { PortfolioProfile } from "../lib/portfolio-types";

type Props = {
  profiles: PortfolioProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
  onCreateProfile: (name: string) => void;
  onDeleteProfile: (id: string) => void;
};

export function ProfileManager({ profiles, selectedProfileId, onSelectProfile, onCreateProfile, onDeleteProfile }: Props) {
  return (
    <section style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "0.8rem" }}>
      <h3 style={{ marginTop: 0 }}>Profile Manager</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0.5rem" }}>
        <select value={selectedProfileId} onChange={(e) => onSelectProfile(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button onClick={() => {
          const name = window.prompt("Profile name");
          if (name?.trim()) onCreateProfile(name.trim());
        }}>New</button>
        <button
          onClick={() => onDeleteProfile(selectedProfileId)}
          disabled={profiles.length <= 1}
        >
          Delete
        </button>
      </div>
    </section>
  );
}

