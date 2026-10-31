import React, { useState } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { HOSPITALS, Hospital, Clinic } from "../data/hospitals";

// In AI Studio the key is injected as process.env.GEMINI_API_KEY.
// For production, call Gemini from a backend instead of the browser.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Msg { role: "user" | "bot"; text: string }
interface Match { hospital: Hospital; clinic: Clinic }
interface Intent { hospitalId: string | null; clinicId: string | null; startAddress: string | null }

const catalog = HOSPITALS.map(h => ({
  hospitalId: h.id, hospital: h.name,
  clinics: h.clinics.map(c => ({ clinicId: c.id, name: c.name, aliases: c.aliases })),
}));

// Gemini ONLY classifies the request into ids from our catalog (structured JSON).
async function understand(text: string): Promise<Intent> {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: text,
    config: {
      systemInstruction:
        "You help patients find clinics. Map the user's message to a hospitalId and clinicId " +
        "from this catalog only; use null if unsure. If the user states where they are starting " +
        "from (address, city, station), put it in startAddress, else null. Catalog: " +
        JSON.stringify(catalog),
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hospitalId: { type: Type.STRING, nullable: true },
          clinicId: { type: Type.STRING, nullable: true },
          startAddress: { type: Type.STRING, nullable: true },
        },
        required: ["hospitalId", "clinicId", "startAddress"],
      },
    },
  });
  return JSON.parse(res.text ?? "{}");
}

type Origin = string | { lat: number; lng: number } | null;

function mapsUrl(h: Hospital, origin: Origin) {
  const p = new URLSearchParams({
    api: "1",
    destination: `${h.location.lat},${h.location.lng}`,
    travelmode: "transit",
  });
  if (origin) p.set("origin", typeof origin === "string" ? origin : `${origin.lat},${origin.lng}`);
  // Without origin, Google Maps uses the device's current location.
  return `https://www.google.com/maps/dir/?${p}`;
}

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000 }
    );
  });
}

export default function HospitalGuide() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "bot", text: "Hi! Tell me the hospital and clinic (e.g. \"Gynaecology at Umberto I\"). You can also say where you are starting from." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<Match | null>(null);
  const [startAddress, setStartAddress] = useState<string | null>(null);
  const [routeUrl, setRouteUrl] = useState<string | null>(null);

  const say = (role: Msg["role"], text: string) => setMsgs(m => [...m, { role, text }]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); say("user", text); setBusy(true);
    try {
      const intent = await understand(text);
      const hospital = HOSPITALS.find(h => h.id === intent.hospitalId);
      const clinic = hospital?.clinics.find(c => c.id === intent.clinicId);
      if (intent.startAddress) setStartAddress(intent.startAddress);

      if (hospital && clinic) {
        setMatch({ hospital, clinic });
        const start = intent.startAddress ?? startAddress;
        setRouteUrl(start ? mapsUrl(hospital, start) : null);
        say("bot", `${clinic.name} — ${hospital.name}: ${clinic.building}, ${clinic.floor}. ${clinic.directions}` +
          (start ? " Your route from the address you gave is ready below." : " Use \"Route from my position\" for directions."));
      } else if (match && intent.startAddress) {
        setRouteUrl(mapsUrl(match.hospital, intent.startAddress));
        say("bot", `Route from ${intent.startAddress} is ready below.`);
      } else {
        say("bot", "I couldn't find that clinic in my directory. Please name the hospital and the clinic/department.");
      }
    } catch {
      say("bot", "Sorry, something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  async function routeFromMyPosition() {
    if (!match) return;
    const pos = await getPosition();
    setRouteUrl(mapsUrl(match.hospital, pos)); // null => Google Maps uses device location
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "sans-serif" }}>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, height: 260, overflowY: "auto" }}>
        {msgs.map((m, i) => (
          <p key={i} style={{ textAlign: m.role === "user" ? "right" : "left" }}>
            <span style={{ background: m.role === "user" ? "#d6e8ff" : "#eee", padding: "6px 10px", borderRadius: 12, display: "inline-block" }}>{m.text}</span>
          </p>
        ))}
        {busy && <p>…</p>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder="e.g. Gynaecology clinic at Umberto I, I'm at Termini station" style={{ flex: 1, padding: 8 }} />
        <button onClick={send} disabled={busy}>Send</button>
      </div>

      {match && (
        <section style={{ marginTop: 16 }}>
          <h3>{match.clinic.name} — {match.hospital.name}</h3>
          <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
            <img src={match.clinic.mapImageUrl} alt={`Map of ${match.clinic.name}`} style={{ width: "100%", display: "block" }} />
            <div title={match.clinic.name} style={{
              position: "absolute", left: `${match.clinic.marker.x}%`, top: `${match.clinic.marker.y}%`,
              width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: "50%",
              background: "red", border: "3px solid white", boxShadow: "0 0 0 3px rgba(255,0,0,.4)",
            }} />
          </div>
          <p style={{ fontSize: 12, color: "#666" }}>
            Map source: <a href={match.hospital.officialSourceUrl} target="_blank" rel="noreferrer">official hospital website</a> (last checked {match.hospital.mapsLastChecked}). Always follow on-site signs.
          </p>
          <button onClick={routeFromMyPosition}>Route from my position</button>{" "}
          {routeUrl && <a href={routeUrl} target="_blank" rel="noreferrer">Open route in Google Maps ↗</a>}
        </section>
      )}
    </div>
  );
}
