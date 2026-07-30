// City → [longitude, latitude] for every city the seed can emit (deep projects are
// hand-placed; light projects draw from seed/generate.py CITIES). Coordinates are
// approximate city centers — plenty for a portfolio map. Unknown cities fall back
// to their state's centroid so a future seed change degrades gracefully (dot at the
// state center + one console.warn) instead of dropping the project from the map.
const CITY_COORDS = {
  // deep-project cities
  "Aurora, IL": [-88.320, 41.760],
  "Cedar Rapids, IA": [-91.664, 41.978],
  "Madison, WI": [-89.401, 43.073],
  "Joliet, IL": [-88.081, 41.525],
  "Chandler, AZ": [-111.841, 33.306],
  "Chicago, IL": [-87.630, 41.878],
  "Hammond, IN": [-87.500, 41.583],
  "Champaign, IL": [-88.243, 40.116],
  // light-project city pool (seed CITIES)
  "Columbus, OH": [-82.999, 39.961],
  "Phoenix, AZ": [-112.074, 33.448],
  "Nashville, TN": [-86.781, 36.163],
  "Austin, TX": [-97.743, 30.267],
  "Atlanta, GA": [-84.388, 33.749],
  "Dallas, TX": [-96.797, 32.777],
  "Denver, CO": [-104.991, 39.739],
  "Kansas City, MO": [-94.579, 39.100],
  "St. Louis, MO": [-90.199, 38.627],
  "Memphis, TN": [-90.049, 35.150],
  "Louisville, KY": [-85.758, 38.253],
  "Indianapolis, IN": [-86.158, 39.768],
  "Des Moines, IA": [-93.609, 41.587],
  "Omaha, NE": [-95.934, 41.257],
  "Tulsa, OK": [-95.993, 36.154],
  "Reno, NV": [-119.814, 39.530],
  "Boise, ID": [-116.202, 43.615],
  "Salt Lake City, UT": [-111.891, 40.761],
  "Tucson, AZ": [-110.975, 32.222],
  "Albuquerque, NM": [-106.650, 35.084],
  "San Antonio, TX": [-98.495, 29.424],
  "Fort Worth, TX": [-97.331, 32.756],
  "Charlotte, NC": [-80.843, 35.227],
  "Raleigh, NC": [-78.638, 35.780],
  "Richmond, VA": [-77.436, 37.541],
  "Columbia, SC": [-81.035, 34.001],
  "Savannah, GA": [-81.100, 32.081],
  "Jacksonville, FL": [-81.656, 30.332],
  "Tampa, FL": [-82.457, 27.951],
  "Orlando, FL": [-81.379, 28.538],
  "Grand Rapids, MI": [-85.668, 42.963],
  "Detroit, MI": [-83.046, 42.331],
  "Cleveland, OH": [-81.694, 41.499],
  "Cincinnati, OH": [-84.512, 39.103],
  "Pittsburgh, PA": [-79.996, 40.441],
  "Minneapolis, MN": [-93.265, 44.978],
  "Milwaukee, WI": [-87.906, 43.039],
  "Lincoln, NE": [-96.681, 40.813],
  "Green Bay, WI": [-88.019, 44.513],
};

const STATE_CENTROIDS = {
  AL: [-86.83, 32.80], AK: [-152.28, 64.07], AZ: [-111.66, 34.29], AR: [-92.44, 34.90],
  CA: [-119.47, 37.18], CO: [-105.55, 38.99], CT: [-72.73, 41.62], DE: [-75.51, 38.99],
  FL: [-81.63, 28.63], GA: [-83.44, 32.65], HI: [-156.37, 20.29], ID: [-114.61, 44.35],
  IL: [-89.20, 40.06], IN: [-86.28, 39.91], IA: [-93.50, 42.08], KS: [-98.38, 38.49],
  KY: [-85.30, 37.53], LA: [-91.99, 31.07], ME: [-69.24, 45.37], MD: [-76.77, 39.06],
  MA: [-71.81, 42.26], MI: [-85.44, 44.35], MN: [-94.31, 46.28], MS: [-89.66, 32.74],
  MO: [-92.46, 38.35], MT: [-109.63, 47.03], NE: [-99.80, 41.54], NV: [-116.65, 39.33],
  NH: [-71.58, 43.68], NJ: [-74.67, 40.19], NM: [-106.11, 34.41], NY: [-75.52, 42.94],
  NC: [-79.39, 35.56], ND: [-100.47, 47.45], OH: [-82.79, 40.29], OK: [-97.49, 35.59],
  OR: [-120.56, 43.93], PA: [-77.80, 40.87], RI: [-71.56, 41.68], SC: [-80.90, 33.92],
  SD: [-100.23, 44.44], TN: [-86.34, 35.86], TX: [-99.35, 31.48], UT: [-111.68, 39.31],
  VT: [-72.66, 44.07], VA: [-78.81, 37.52], WA: [-120.45, 47.38], WV: [-80.61, 38.64],
  WI: [-89.73, 44.64], WY: [-107.55, 43.00],
};

const warned = new Set();
export function coordsFor(city, state) {
  const key = `${city}, ${state}`;
  const hit = CITY_COORDS[key];
  if (hit) return hit;
  if (!warned.has(key)) { warned.add(key); console.warn(`[map] no coordinates for "${key}" — using state centroid`); }
  return STATE_CENTROIDS[state] || [-98.58, 39.83]; // geographic center of the lower 48
}
