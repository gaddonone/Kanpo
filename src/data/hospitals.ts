// Registry of hospitals with VERIFIED floor plans. Any other Italian hospital is
// still handled via Google Places + grounded search (see services/guide.ts).
// Curated hospital directory. Fill/refresh this from the hospital's OFFICIAL site.
// Never let the model invent locations: it only picks an id from this list.

export interface Clinic {
  id: string;
  name: string;
  aliases: string[];      // e.g. "gynecology", "ginecologia"
  building: string;
  floor: string;
  directions: string;     // indoor text instructions from the entrance
  // Marker position on the floor-plan image, in % (0-100) of width/height
  marker: { x: number; y: number };
  mapImageUrl: string;    // floor plan image from the official source
}

export interface Hospital {
  id: string;
  placeId?: string;       // Google Place ID (optional; else matched by location)
  name: string;
  address: string;
  location: { lat: number; lng: number }; // main entrance
  officialSourceUrl: string;              // where the maps come from
  mapsLastChecked: string;                // ISO date you verified the maps
  clinics: Clinic[];
}

export const REGISTRY: Hospital[] = [
  {
    id: "umberto-i",
    name: "Policlinico Umberto I",
    address: "Viale del Policlinico, 155, 00161 Roma RM, Italy",
    location: { lat: 41.9087, lng: 12.5122 }, // verify exact entrance coordinates
    officialSourceUrl: "https://www.policlinicoumberto1.it",
    mapsLastChecked: "2026-01-01",
    clinics: [
      {
        id: "gyn",
        name: "Clinica Ginecologica (Ginecologia e Ostetricia)",
        aliases: ["gynaecology", "gynecology", "ginecologia", "ostetricia", "obstetrics"],
        building: "Ginecologia e Ostetricia building", // verify
        floor: "Ground floor",                          // verify
        directions: "Enter from the main gate on Viale del Policlinico and follow the signs for Ginecologia.", // verify
        marker: { x: 62, y: 38 },
        mapImageUrl: "/maps/umberto-i-campus.png", // replace with the official map image
      },
    ],
  },
];
