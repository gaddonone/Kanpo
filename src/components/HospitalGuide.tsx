import React, { useState } from "react";
import { Hospital, Clinic } from "../data/hospitals";
import {
  understand, findHospital, lookupRegistry, pickClinic, searchOfficialInfo,
  mapsUrl, getPosition, Place,
} from "../services/guide";

interface Msg { role: "user" | "bot"; text: string }
interface Source { title: string; uri: string }
interface Result { place: Place; registry: Hospital | null; clinic: Clinic | null; sources: Source[] }

export default function HospitalGuide() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "bot", text: "Ciao! Dimmi quale ospedale e quale reparto cerchi (es. \"Ginecologia al Policlinico Umberto I di Roma\"). Puoi dirmi anche da dove parti." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [startAddress, setStartAddress] = useState<string | null>(null);
  const [routeUrl, setRouteUrl] = useState<string | null>(null);

  const say = (role: Msg["role"], text: string) => setMsgs(m => [...m, { role, text }]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); say("user", text); setBusy(true);
    try {
      const intent = await understand(text);
      const start = intent.startAddress ?? startAddress;
      if (intent.startAddress) setStartAddress(intent.startAddress);

      // Follow-up like "I'm at Termini": reuse the current hospital.
      if (!intent.hospitalQuery && result && intent.startAddress) {
        setRouteUrl(mapsUrl(result.place, intent.startAddress));
        say("bot", `Percorso da ${intent.startAddress} pronto qui sotto.`);
        return;
      }
      if (!intent.hospitalQuery) {
        say("bot", "Non ho capito quale ospedale cerchi. Indica nome e città.");
        return;
      }
      const place = await findHospital(intent.hospitalQuery);
      if (!place) { say("bot", "Non ho trovato questo ospedale. Prova con nome e città."); return; }

      const registry = lookupRegistry(place);
      let clinic: Clinic | null = null;
      let sources: Source[] = [];
      let reply: string;

      if (registry && intent.department) clinic = await pickClinic(registry, intent.department);

      if (registry && clinic) {
        reply = `${clinic.name} — ${registry.name}: ${clinic.building}, ${clinic.floor}. ${clinic.directions}`;
      } else {
        // Not in registry (or clinic unknown): grounded search of official sources.
        const info = await searchOfficialInfo(place, intent.department);
        sources = info.sources;
        reply = `${place.name} (${place.address}).\n${info.text}\n` +
          "Nota: non ho una planimetria verificata per questo reparto; controlla le fonti ufficiali.";
      }
      setResult({ place, registry, clinic, sources });
      setRouteUrl(start ? mapsUrl(place, start) : null);
      say("bot", reply + (start ? "\nPercorso pronto qui sotto." : "\nUsa \"Percorso dalla mia posizione\"."));
    } catch {
      say("bot", "Si è verificato un errore. Riprova.");
    } finally { setBusy(false); }
  }

  async function routeFromMyPosition() {
    if (!result) return;
    setRouteUrl(mapsUrl(result.place, await getPosition())); // null => Maps uses device location
  }

  const bubble = (role: Msg["role"]) => ({
    background: role === "user" ? "#d6e8ff" : "#eee", padding: "6px 10px", borderRadius: 12, display: "inline-block",
  });
  const marker = (c: Clinic) => ({
    position: "absolute" as const, left: `${c.marker.x}%`, top: `${c.marker.y}%`,
    width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: "50%",
    background: "red", border: "3px solid white", boxShadow: "0 0 0 3px rgba(255,0,0,.4)",
  });

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "sans-serif" }}>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, height: 280, overflowY: "auto" }}>
        {msgs.map((m, i) => (
          <p key={i} style={{ textAlign: m.role === "user" ? "right" : "left", whiteSpace: "pre-wrap" }}>
            <span style={bubble(m.role)}>{m.text}</span>
          </p>
        ))}
        {busy && <p>…</p>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Es. Cardiologia al Cardarelli di Napoli, parto da Piazza Garibaldi" style={{ flex: 1, padding: 8 }} />
        <button onClick={send} disabled={busy}>Invia</button>
      </div>

      {result && (
        <section style={{ marginTop: 16 }}>
          <h3>{result.clinic ? result.clinic.name + " — " : ""}{result.place.name}</h3>
          {result.registry && result.clinic && (
            <>
              <div style={{ position: "relative", width: "100%" }}>
                <img src={result.clinic.mapImageUrl} alt={`Mappa ${result.clinic.name}`} style={{ width: "100%", display: "block" }} />
                <div title={result.clinic.name} style={marker(result.clinic)} />
              </div>
              <p style={{ fontSize: 12, color: "#666" }}>
                Fonte: <a href={result.registry.officialSourceUrl} target="_blank" rel="noreferrer">sito ufficiale</a> (verificata il {result.registry.mapsLastChecked}). Segui sempre la segnaletica.
              </p>
            </>
          )}
          {result.sources.length > 0 && (
            <ul style={{ fontSize: 13 }}>
              {result.sources.map(s => <li key={s.uri}><a href={s.uri} target="_blank" rel="noreferrer">{s.title}</a></li>)}
            </ul>
          )}
          {result.place.website && <p><a href={result.place.website} target="_blank" rel="noreferrer">Sito dell'ospedale ↗</a></p>}
          <button onClick={routeFromMyPosition}>Percorso dalla mia posizione</button>{" "}
          {routeUrl && <a href={routeUrl} target="_blank" rel="noreferrer">Apri il percorso in Google Maps ↗</a>}
        </section>
      )}
    </div>
  );
}
