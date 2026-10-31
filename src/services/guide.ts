import { GoogleGenAI, Type } from "@google/genai";
import { REGISTRY, Hospital, Clinic } from "../data/hospitals";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const PLACES_KEY = process.env.GOOGLE_MAPS_API_KEY; // Places API (New) enabled

export interface Intent {
  hospitalQuery: string | null; // e.g. "Policlinico Umberto I Roma"
  department: string | null;    // e.g. "ginecologia"
  startAddress: string | null;
}
export interface Place {
  id: string; name: string; address: string; website?: string;
  location: { lat: number; lng: number };
}
export type LatLng = { lat: number; lng: number };

const nullableStr = { type: Type.STRING, nullable: true };

export async function understand(text: string): Promise<Intent> {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: text,
    config: {
      systemInstruction:
        "Extract from the patient's message: the Italian hospital (name + city if given), " +
        "the clinic/department wanted (in Italian), and the starting address/place if stated. " +
        "Use null for anything not stated. Never guess.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { hospitalQuery: nullableStr, department: nullableStr, startAddress: nullableStr },
        required: ["hospitalQuery", "department", "startAddress"],
      },
    },
  });
  return JSON.parse(res.text ?? "{}");
}

// Works for ANY hospital in Italy via Google Places (New) Text Search.
export async function findHospital(query: string): Promise<Place | null> {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY ?? "",
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri",
    },
    body: JSON.stringify({ textQuery: query, includedType: "hospital", regionCode: "IT", languageCode: "it", pageSize: 1 }),
  });
  if (!r.ok) return null;
  const p = (await r.json()).places?.[0];
  if (!p) return null;
  return {
    id: p.id, name: p.displayName?.text, address: p.formattedAddress, website: p.websiteUri,
    location: { lat: p.location.latitude, lng: p.location.longitude },
  };
}

function distanceM(a: LatLng, b: LatLng) {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Registry entries are matched by Places id, or by proximity (<400 m) to the Places result.
export function lookupRegistry(p: Place): Hospital | null {
  return REGISTRY.find(h => h.placeId === p.id || distanceM(h.location, p.location) < 400) ?? null;
}

export async function pickClinic(h: Hospital, department: string): Promise<Clinic | null> {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: department,
    config: {
      systemInstruction: "Pick the clinic id that matches the requested department, or null. Clinics: " +
        JSON.stringify(h.clinics.map(c => ({ id: c.id, name: c.name, aliases: c.aliases }))),
      responseMimeType: "application/json",
      responseSchema: { type: Type.OBJECT, properties: { clinicId: nullableStr }, required: ["clinicId"] },
    },
  });
  const id = JSON.parse(res.text ?? "{}").clinicId;
  return h.clinics.find(c => c.id === id) ?? null;
}

// Fallback for hospitals not in the registry: grounded search of the official site.
export async function searchOfficialInfo(p: Place, department: string | null) {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents:
      `Per l'ospedale "${p.name}" (${p.address}${p.website ? ", sito " + p.website : ""}), trova sul sito ufficiale ` +
      `la mappa/planimetria aggiornata e dove si trova ${department ?? "il reparto richiesto"} ` +
      `(edificio, piano, indicazioni). Rispondi in modo breve. Se non trovi l'informazione, dillo chiaramente: non inventare.`,
    config: { tools: [{ googleSearch: {} }] },
  });
  const sources = (res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
    .map(c => c.web).filter(w => w?.uri).map(w => ({ title: w!.title ?? w!.uri!, uri: w!.uri! }));
  return { text: res.text ?? "", sources };
}

export function mapsUrl(p: { id?: string; name: string; location: LatLng }, origin: string | LatLng | null) {
  const q = new URLSearchParams({
    api: "1", destination: `${p.location.lat},${p.location.lng}`, travelmode: "transit",
  });
  if (p.id) q.set("destination_place_id", p.id);
  if (origin) q.set("origin", typeof origin === "string" ? origin : `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${q}`;
}

export function getPosition(): Promise<LatLng | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { timeout: 8000 });
  });
}
