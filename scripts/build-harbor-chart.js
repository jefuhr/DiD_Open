// Generates modern vector cartography for New York Harbor.
//
// Produces content/harbor-chart.json, which the server folds into /api/map at boot.
// Contains:
// 1. Waterways and Landmass (shoreline polygons for boroughs and islands)
// 2. Major streets only (arterials and expressways)
// 3. All bridges across waterways with vertical clearance and clearance status
// 4. Naval markings (OpenSeaMap/NOAA lighthouses, range lights, channel buoys, navigation fairways)
// 5. Zero ferry route lines (routes are dynamically drawn by the app)
//
// Designed to pull colors natively from theme CSS variables (--map-water, --map-land,
// --map-street, --map-bridge, --map-seamark).

import { mkdir, writeFile } from "node:fs/promises";
import shoreline from "../content/harbor-shoreline.json" with { type: "json" };
import manhattanDetails from "../content/manhattan-details.json" with { type: "json" };
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Precision rounding helper (~1 metre accuracy)
function pt(lat, lon) {
  return [Math.round(lat * 100000) / 100000, Math.round(lon * 100000) / 100000];
}

export function buildHarborChartData() {
  // Shoreline polygons are bundled from OSM instead of approximating the coast by hand.
  const landmass = shoreline.landmass;


  // ---------------------------------------------------------------- Major Streets
  const streets = [...manhattanDetails.streets, ...shoreline.streets];


  // ---------------------------------------------------------------- Bridges (All Water Clearances)
  const bridges = [
    {
      id: "brooklyn-bridge",
      name: "Brooklyn Bridge",
      waterway: "East River",
      type: "Suspension Bridge",
      clearanceFeet: 127,
      clearanceMeters: 38.7,
      clearanceNote: "127 ft MHW (Mean High Water)",
      cleared: true,
      points: [pt(40.7107, -74.0001), pt(40.7005, -73.9897)]
    },
    {
      id: "manhattan-bridge",
      name: "Manhattan Bridge",
      waterway: "East River",
      type: "Suspension Bridge",
      clearanceFeet: 135,
      clearanceMeters: 41.1,
      clearanceNote: "135 ft MHW",
      cleared: true,
      points: [pt(40.7136, -73.9947), pt(40.7025, -73.9856)]
    },
    {
      id: "williamsburg-bridge",
      name: "Williamsburg Bridge",
      waterway: "East River",
      type: "Suspension Bridge",
      clearanceFeet: 135,
      clearanceMeters: 41.1,
      clearanceNote: "135 ft MHW",
      cleared: true,
      points: [pt(40.7166, -73.9818), pt(40.7106, -73.9634)]
    },
    {
      id: "queensboro-bridge",
      name: "Queensboro (59th St) Bridge",
      waterway: "East River",
      type: "Cantilever Bridge",
      clearanceFeet: 131,
      clearanceMeters: 39.9,
      clearanceNote: "131 ft West Channel / 130 ft East Channel",
      cleared: true,
      points: [pt(40.7604, -73.9631), pt(40.7533, -73.9452)]
    },
    {
      id: "roosevelt-island-bridge",
      name: "Roosevelt Island Bridge",
      waterway: "East River (East Channel)",
      type: "Vertical Lift Bridge",
      clearanceFeet: 40,
      clearanceMeters: 12.2,
      clearanceOpenFeet: 100,
      clearanceNote: "40 ft closed / 100 ft open",
      cleared: true,
      points: [pt(40.7634, -73.9515), pt(40.7623, -73.9482)]
    },
    {
      id: "rfk-east-river-bridge",
      name: "RFK / Triborough Bridge (East River Span)",
      waterway: "East River / Hell Gate",
      type: "Suspension Bridge",
      clearanceFeet: 143,
      clearanceMeters: 43.6,
      clearanceNote: "143 ft MHW",
      cleared: true,
      points: [pt(40.7851, -73.9272), pt(40.7744, -73.9221)]
    },
    {
      id: "hell-gate-bridge",
      name: "Hell Gate Bridge",
      waterway: "East River / Hell Gate",
      type: "Steel Arch Bridge",
      clearanceFeet: 135,
      clearanceMeters: 41.1,
      clearanceNote: "135 ft MHW (Amtrak Northeast Corridor)",
      cleared: true,
      points: [pt(40.7871, -73.9255), pt(40.7766, -73.9202)]
    },
    {
      id: "rfk-harlem-river-bridge",
      name: "RFK / Triborough Bridge (Harlem River Span)",
      waterway: "Harlem River",
      type: "Vertical Lift Bridge",
      clearanceFeet: 55,
      clearanceMeters: 16.8,
      clearanceOpenFeet: 135,
      clearanceNote: "55 ft closed / 135 ft open",
      cleared: true,
      points: [pt(40.8016, -73.9317), pt(40.8016, -73.9257)]
    },
    {
      id: "rfk-bronx-kills-bridge",
      name: "RFK / Triborough Bridge (Bronx Kills Span)",
      waterway: "Bronx Kills",
      type: "Truss Bridge",
      clearanceFeet: 50,
      clearanceMeters: 15.2,
      clearanceNote: "50 ft MHW",
      cleared: true,
      points: [pt(40.7997, -73.9189), pt(40.7979, -73.9179)]
    },
    {
      id: "rikers-island-bridge",
      name: "Rikers Island Bridge",
      waterway: "Rikers Island Channel",
      type: "Girder Bridge",
      clearanceFeet: 52,
      clearanceMeters: 15.8,
      clearanceNote: "52 ft MHW",
      cleared: true,
      points: [pt(40.7758, -73.8967), pt(40.7868, -73.8819)]
    },
    {
      id: "bronx-whitestone-bridge",
      name: "Bronx-Whitestone Bridge",
      waterway: "East River / Long Island Sound",
      type: "Suspension Bridge",
      clearanceFeet: 135,
      clearanceMeters: 41.1,
      clearanceNote: "135–150 ft MHW",
      cleared: true,
      points: [pt(40.8122, -73.8344), pt(40.7884, -73.8260)]
    },
    {
      id: "throgs-neck-bridge",
      name: "Throgs Neck Bridge",
      waterway: "Long Island Sound",
      type: "Suspension Bridge",
      clearanceFeet: 142,
      clearanceMeters: 43.3,
      clearanceNote: "142 ft MHW",
      cleared: true,
      points: [pt(40.8089, -73.7942), pt(40.7905, -73.7892)]
    },
    {
      id: "george-washington-bridge",
      name: "George Washington Bridge",
      waterway: "Hudson River",
      type: "Suspension Bridge",
      clearanceFeet: 212,
      clearanceMeters: 64.6,
      clearanceNote: "212 ft MHW (World-Class Clearance)",
      cleared: true,
      points: [pt(40.8522, -73.9622), pt(40.8512, -73.9432)]
    },
    {
      id: "verrazzano-narrows-bridge",
      name: "Verrazzano-Narrows Bridge",
      waterway: "The Narrows",
      type: "Suspension Bridge",
      clearanceFeet: 228,
      clearanceMeters: 69.5,
      clearanceNote: "228 ft MHW (Major Harbor Gateway Clearance)",
      cleared: true,
      points: [pt(40.6033, -74.0538), pt(40.6099, -74.0356)]
    },
    {
      id: "bayonne-bridge",
      name: "Bayonne Bridge",
      waterway: "Kill Van Kull",
      type: "Steel Arch Bridge",
      clearanceFeet: 215,
      clearanceMeters: 65.5,
      clearanceNote: "215 ft MHW (Post-Panamax Navigational Clearance)",
      cleared: true,
      points: [pt(40.6480, -74.1430), pt(40.6354, -74.1404)]
    },
    {
      id: "goethals-bridge",
      name: "Goethals Bridge",
      waterway: "Arthur Kill",
      type: "Cable-Stayed Bridge",
      clearanceFeet: 139,
      clearanceMeters: 42.4,
      clearanceNote: "139 ft MHW",
      cleared: true,
      points: [pt(40.6369, -74.2045), pt(40.6347, -74.1921)]
    },
    {
      id: "outerbridge-crossing",
      name: "Outerbridge Crossing",
      waterway: "Arthur Kill",
      type: "Cantilever Truss Bridge",
      clearanceFeet: 143,
      clearanceMeters: 43.6,
      clearanceNote: "143 ft MHW",
      cleared: true,
      points: [pt(40.5283, -74.2541), pt(40.5217, -74.2425)]
    },
    {
      id: "marine-parkway-bridge",
      name: "Marine Parkway–Gil Hodges Bridge",
      waterway: "Rockaway Inlet",
      type: "Vertical Lift Bridge",
      clearanceFeet: 55,
      clearanceMeters: 16.8,
      clearanceOpenFeet: 152,
      clearanceNote: "55 ft closed / 152 ft open",
      cleared: true,
      points: [pt(40.5794, -73.8883), pt(40.5668, -73.8811)]
    },
    {
      id: "cross-bay-bridge",
      name: "Cross Bay Veterans Memorial Bridge",
      waterway: "Jamaica Bay / Beach Channel",
      type: "Bascule / Girder Bridge",
      clearanceFeet: 52,
      clearanceMeters: 15.8,
      clearanceNote: "52 ft MHW",
      cleared: true,
      points: [pt(40.6012, -73.8202), pt(40.5838, -73.8176)]
    },
    {
      id: "pulaski-bridge",
      name: "Pulaski Bridge",
      waterway: "Newtown Creek",
      type: "Bascule Bridge",
      clearanceFeet: 39,
      clearanceMeters: 11.9,
      clearanceNote: "39 ft closed (Connects Brooklyn & Queens)",
      cleared: true,
      points: [pt(40.7412, -73.9554), pt(40.7364, -73.9522)]
    },
    {
      id: "kosciuszko-bridge",
      name: "Kosciuszko Bridge",
      waterway: "Newtown Creek",
      type: "Cable-Stayed Bridge",
      clearanceFeet: 115,
      clearanceMeters: 35.1,
      clearanceNote: "115 ft MHW (BQE / I-278)",
      cleared: true,
      points: [pt(40.7297, -73.9348), pt(40.7253, -73.9268)]
    },
    {
      id: "high-bridge",
      name: "The High Bridge",
      waterway: "Harlem River",
      type: "Historic Arch Bridge",
      clearanceFeet: 100,
      clearanceMeters: 30.5,
      clearanceNote: "100 ft MHW (Oldest Bridge in NYC)",
      cleared: true,
      points: [pt(40.8433, -73.9338), pt(40.8433, -73.9298)]
    },
    {
      id: "alexander-hamilton-bridge",
      name: "Alexander Hamilton Bridge",
      waterway: "Harlem River",
      type: "Steel Arch Bridge",
      clearanceFeet: 103,
      clearanceMeters: 31.4,
      clearanceNote: "103 ft MHW (Cross Bronx / I-95)",
      cleared: true,
      points: [pt(40.8462, -73.9302), pt(40.8454, -73.9254)]
    },
    {
      id: "henry-hudson-bridge",
      name: "Henry Hudson Bridge",
      waterway: "Spuyten Duyvil Creek",
      type: "Steel Arch Bridge",
      clearanceFeet: 143,
      clearanceMeters: 43.6,
      clearanceNote: "143 ft MHW",
      cleared: true,
      points: [pt(40.8805, -73.9222), pt(40.8751, -73.9222)]
    }
  ];

  // ---------------------------------------------------------------- Naval Seamarks
  const seamarks = [
    {
      id: "robbins-reef-light",
      name: "Robbins Reef Light",
      type: "light",
      subtype: "lighthouse",
      latitude: 40.6551,
      longitude: -74.0656,
      characteristic: "Fl G 6s",
      rangeNm: 7,
      color: "green",
      description: "Upper New York Bay off Bayonne / St. George. Conical spark tower."
    },
    {
      id: "west-bank-light",
      name: "West Bank Light",
      type: "light",
      subtype: "lighthouse",
      latitude: 40.5375,
      longitude: -74.0436,
      characteristic: "Iso W 6s",
      rangeNm: 10,
      color: "white",
      description: "Lower New York Bay, Ambrose Channel range front beacon."
    },
    {
      id: "coney-island-light",
      name: "Coney Island Light (Nortons Point)",
      type: "light",
      subtype: "lighthouse",
      latitude: 40.5739,
      longitude: -74.0017,
      characteristic: "Fl R 5s",
      rangeNm: 10,
      color: "red",
      description: "Nortons Point, Brooklyn. Triangular skeletal tower."
    },
    {
      id: "fort-wadsworth-light",
      name: "Fort Wadsworth Light",
      type: "light",
      subtype: "lighthouse",
      latitude: 40.6053,
      longitude: -74.0531,
      characteristic: "F R",
      rangeNm: 8,
      color: "red",
      description: "The Narrows, Staten Island shore atop historic Fort Wadsworth."
    },
    {
      id: "statue-of-liberty-beacon",
      name: "Statue of Liberty Beacon",
      type: "light",
      subtype: "monument-beacon",
      latitude: 40.6892,
      longitude: -74.0445,
      characteristic: "F G",
      rangeNm: 12,
      color: "gold",
      description: "Liberty Island Torch, historic harbor beacon."
    },
    {
      id: "blackwell-island-light",
      name: "Blackwell Island Light",
      type: "light",
      subtype: "lighthouse",
      latitude: 40.7725,
      longitude: -73.9397,
      characteristic: "F W",
      rangeNm: 6,
      color: "white",
      description: "North tip of Roosevelt Island, East River. Historic 1872 stone tower."
    },
    {
      id: "little-red-lighthouse",
      name: "Jeffrey's Hook Light (Little Red Lighthouse)",
      type: "light",
      subtype: "lighthouse",
      latitude: 40.8508,
      longitude: -73.9472,
      characteristic: "Fl R",
      rangeNm: 5,
      color: "red",
      description: "Hudson River beneath the George Washington Bridge."
    },
    {
      id: "execution-rocks-light",
      name: "Execution Rocks Light",
      type: "light",
      subtype: "offshore-light",
      latitude: 40.8808,
      longitude: -73.7381,
      characteristic: "Fl W 10s",
      rangeNm: 15,
      color: "white",
      description: "Long Island Sound Western Entrance Light."
    },
    {
      id: "stepping-stones-light",
      name: "Stepping Stones Light",
      type: "light",
      subtype: "lighthouse",
      latitude: 40.7917,
      longitude: -73.7825,
      characteristic: "Fl G 4s",
      rangeNm: 8,
      color: "green",
      description: "Long Island Sound / Throggs Neck approach."
    },
    {
      id: "sandy-hook-light",
      name: "Sandy Hook Light",
      type: "light",
      subtype: "historic-lighthouse",
      latitude: 40.4619,
      longitude: -74.0017,
      characteristic: "F W",
      rangeNm: 19,
      color: "white",
      description: "Sandy Hook, NJ. Built 1764, oldest working lighthouse in the United States."
    },
    {
      id: "governors-island-light",
      name: "Governors Island Light & Horn",
      type: "light",
      subtype: "beacon",
      latitude: 40.6842,
      longitude: -74.0189,
      characteristic: "Fl R 4s",
      rangeNm: 6,
      color: "red",
      description: "Southern tip of Governors Island, Buttermilk Channel / Upper Bay entrance."
    },
    {
      id: "ambrose-ac-buoy",
      name: "Ambrose Lighted Buoy AC",
      type: "buoy",
      subtype: "safe-water",
      latitude: 40.4680,
      longitude: -73.8340,
      color: "red-white",
      shape: "sphere",
      description: "Ambrose Channel Entrance Sea Mark (Mo A)"
    },
    {
      id: "ambrose-1-buoy",
      name: "Ambrose Buoy 1",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.4980,
      longitude: -73.9210,
      color: "green",
      shape: "can",
      description: "Ambrose Channel Port Mark (Fl G 2.5s)"
    },
    {
      id: "ambrose-2-buoy",
      name: "Ambrose Buoy 2",
      type: "buoy",
      subtype: "starboard-nun",
      latitude: 40.4950,
      longitude: -73.9180,
      color: "red",
      shape: "nun",
      description: "Ambrose Channel Starboard Mark (Fl R 2.5s)"
    },
    {
      id: "narrows-19-buoy",
      name: "The Narrows Buoy 19",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.5980,
      longitude: -74.0470,
      color: "green",
      shape: "can",
      description: "The Narrows West Channel Gate"
    },
    {
      id: "narrows-20-buoy",
      name: "The Narrows Buoy 20",
      type: "buoy",
      subtype: "starboard-nun",
      latitude: 40.5960,
      longitude: -74.0410,
      color: "red",
      shape: "nun",
      description: "The Narrows East Channel Gate"
    },
    {
      id: "narrows-24-buoy",
      name: "The Narrows Buoy 24",
      type: "buoy",
      subtype: "starboard-nun",
      latitude: 40.6220,
      longitude: -74.0390,
      color: "red",
      shape: "nun",
      description: "Verrazzano North Approach Channel"
    },
    {
      id: "upper-bay-25-buoy",
      name: "Upper Bay Buoy 25",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.6480,
      longitude: -74.0580,
      color: "green",
      shape: "can",
      description: "Upper Bay / Kill Van Kull junction"
    },
    {
      id: "upper-bay-28-buoy",
      name: "Upper Bay Buoy 28",
      type: "buoy",
      subtype: "starboard-nun",
      latitude: 40.6710,
      longitude: -74.0320,
      color: "red",
      shape: "nun",
      description: "Main Ship Channel Starboard Mark"
    },
    {
      id: "hudson-1-buoy",
      name: "Hudson River Buoy 1",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.7020,
      longitude: -74.0190,
      color: "green",
      shape: "can",
      description: "Battery Park Approach Gate (Fl G 4s)"
    },
    {
      id: "hudson-3-buoy",
      name: "Hudson River Buoy 3",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.7630,
      longitude: -74.0090,
      color: "green",
      shape: "can",
      description: "Midtown / Pier 79 Navigation Approach"
    },
    {
      id: "east-river-er-buoy",
      name: "East River Buoy ER",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.6990,
      longitude: -74.0110,
      color: "green",
      shape: "can",
      description: "Governors Island / East River Channel Entrance"
    },
    {
      id: "buttermilk-1-buoy",
      name: "Buttermilk Channel Buoy 1",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.6860,
      longitude: -74.0140,
      color: "green",
      shape: "can",
      description: "Governors Island East Passage"
    },
    {
      id: "buttermilk-2-buoy",
      name: "Buttermilk Channel Buoy 2",
      type: "buoy",
      subtype: "starboard-nun",
      latitude: 40.6880,
      longitude: -74.0080,
      color: "red",
      shape: "nun",
      description: "Brooklyn Atlantic Basin Passage"
    },
    {
      id: "hell-gate-1-buoy",
      name: "Hell Gate Buoy HG-1",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.7780,
      longitude: -73.9310,
      color: "green",
      shape: "can",
      description: "Hell Gate Deepwater Channel (Fl G 2.5s)"
    },
    {
      id: "hell-gate-2-buoy",
      name: "Hell Gate Buoy HG-2",
      type: "buoy",
      subtype: "starboard-nun",
      latitude: 40.7830,
      longitude: -73.9250,
      color: "red",
      shape: "nun",
      description: "Hell Gate Starboard Mark (Fl R 2.5s)"
    },
    {
      id: "rockaway-inlet-rw-buoy",
      name: "Rockaway Inlet Buoy RW RI",
      type: "buoy",
      subtype: "safe-water",
      latitude: 40.5410,
      longitude: -73.9350,
      color: "red-white",
      shape: "sphere",
      description: "Rockaway Inlet Sea Fairway Mark (Mo A)"
    },
    {
      id: "rockaway-inlet-1-buoy",
      name: "Rockaway Inlet Buoy 1",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.5620,
      longitude: -73.9050,
      color: "green",
      shape: "can",
      description: "Rockaway Inlet Channel North"
    },
    {
      id: "rockaway-inlet-2-buoy",
      name: "Rockaway Inlet Buoy 2",
      type: "buoy",
      subtype: "starboard-nun",
      latitude: 40.5580,
      longitude: -73.9120,
      color: "red",
      shape: "nun",
      description: "Breezy Point Starboard Mark"
    },
    {
      id: "sandy-hook-1-buoy",
      name: "Sandy Hook Channel Buoy 1",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.4850,
      longitude: -74.0120,
      color: "green",
      shape: "can",
      description: "Sandy Hook Bay Channel Gate"
    },
    {
      id: "compton-creek-1-buoy",
      name: "Compton Creek Buoy 1 (Belford)",
      type: "buoy",
      subtype: "port-can",
      latitude: 40.4430,
      longitude: -74.0810,
      color: "green",
      shape: "can",
      description: "Belford Ferry Terminal Approach Channel"
    }
  ];

  // ---------------------------------------------------------------- Navigation Fairways (Channels)
  const channels = [
    {
      id: "ambrose-channel",
      name: "Ambrose Channel Fairway",
      points: [
        pt(40.4680, -73.8340), pt(40.4860, -73.8820), pt(40.5050, -73.9400),
        pt(40.5280, -73.9950), pt(40.5650, -74.0320), pt(40.5980, -74.0440)
      ]
    },
    {
      id: "the-narrows-channel",
      name: "The Narrows Deepwater Route",
      points: [
        pt(40.5980, -74.0440), pt(40.6120, -74.0420), pt(40.6350, -74.0400),
        pt(40.6550, -74.0380), pt(40.6750, -74.0300)
      ]
    },
    {
      id: "hudson-river-channel",
      name: "Hudson River Navigational Channel",
      points: [
        pt(40.6990, -74.0200), pt(40.7180, -74.0180), pt(40.7420, -74.0160),
        pt(40.7680, -74.0100), pt(40.8050, -73.9850), pt(40.8520, -73.9550)
      ]
    },
    {
      id: "east-river-channel",
      name: "East River Navigational Fairway",
      points: [
        pt(40.6990, -74.0110), pt(40.7060, -73.9960), pt(40.7130, -73.9780),
        pt(40.7250, -73.9630), pt(40.7450, -73.9620), pt(40.7680, -73.9450),
        pt(40.7800, -73.9280), pt(40.7950, -73.9050), pt(40.8080, -73.8400)
      ]
    },
    {
      id: "rockaway-inlet-channel",
      name: "Rockaway Inlet Fairway",
      points: [
        pt(40.5410, -73.9350), pt(40.5550, -73.9180), pt(40.5650, -73.8980),
        pt(40.5740, -73.8750), pt(40.5820, -73.8450), pt(40.5850, -73.8200)
      ]
    }
  ];

  return {
    version: 2,
    name: "New York Harbor Navigational Chart",
    generatedAt: new Date().toISOString(),
    description: "Modern vector cartography for New York Harbor with landmass, major streets, bridges with clearances, and naval seamarks. Base chart carries zero route lines.",
    landmass,
    parks: manhattanDetails.parks,
    shoreline: { source: shoreline.source, sourceUrl: shoreline.sourceUrl, license: shoreline.license, generatedAt: shoreline.generatedAt },
    streets,
    bridges,
    seamarks,
    channels
  };
}

// Written to content/ only. There used to be a byte-identical copy at public/assets/, which put a
// second megabyte in the repository that nothing ever fetched: the map page reads the chart out of
// /api/map, which the server builds from the content/ copy at boot. A file under public/ is a file
// the world can download, so a spare one is not free.
export async function writeHarborChart(options = {}) {
  const root = options.root || ROOT;
  const data = buildHarborChartData();
  const json = JSON.stringify(data) + "\n";

  const contentDir = path.join(root, "content");
  await mkdir(contentDir, { recursive: true });
  await writeFile(path.join(contentDir, "harbor-chart.json"), json, "utf8");

  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const chart = await writeHarborChart();
  console.log(`Generated harbor chart with ${chart.landmass.length} landmasses, ${chart.streets.length} major streets, ${chart.bridges.length} bridges, and ${chart.seamarks.length} seamarks.`);
}
