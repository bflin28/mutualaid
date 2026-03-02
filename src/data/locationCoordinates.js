/**
 * Static coordinate dictionary for all rescue, warehouse, and distribution locations.
 * Types: 'rescue' (grocery stores, farms, donors), 'warehouse' (hubs), 'distribution' (pantries, mutual aid orgs)
 */

const LOCATIONS = {
  // ============ WAREHOUSE HUBS ============
  'Keystone': { lat: 41.9145, lng: -87.7318, type: 'warehouse', address: '2311 N Keystone Ave' },
  'Urban Canopy': { lat: 41.8497, lng: -87.6833, type: 'warehouse', address: '2550 S Leavitt St, Pilsen' },

  // ============ RESCUE SOURCES ============
  // Aldi locations
  'Aldi Kostner': { lat: 41.9074, lng: -87.7350, type: 'rescue', address: '1440 N Kostner Ave' },
  'Aldi Wicker Park': { lat: 41.9130, lng: -87.6745, type: 'rescue', address: '1753 N Milwaukee Ave' },
  'Aldi Belmont': { lat: 41.9393, lng: -87.7116, type: 'rescue', address: '3320 W Belmont Ave' },
  'Aldi Avondale': { lat: 41.9393, lng: -87.7116, type: 'rescue', address: '3320 W Belmont Ave' },
  'Aldi Englewood': { lat: 41.7793, lng: -87.6466, type: 'rescue', address: '815 W 63rd St' },
  'Aldi Hodgkins': { lat: 41.7686, lng: -87.8578, type: 'rescue', address: '9248 Joliet Rd, Hodgkins' },
  'Aldi Lyons': { lat: 41.8133, lng: -87.8183, type: 'rescue', address: '8935 Ogden Ave, Lyons' },
  'Aldi (unknown)': { lat: 41.8850, lng: -87.7100, type: 'rescue' },

  // Major grocery stores
  'Whole Foods': { lat: 41.9394, lng: -87.6692, type: 'rescue', address: '3201 N Ashland Ave' },
  "Mariano's": { lat: 41.8600, lng: -87.6310, type: 'rescue', address: '1615 S Clark St' },
  "Mariano's South Loop": { lat: 41.8600, lng: -87.6310, type: 'rescue', address: '1615 S Clark St' },
  'Costco': { lat: 41.8520, lng: -87.6660, type: 'rescue', address: '1430 S Ashland Ave' },
  'Jewel': { lat: 41.9100, lng: -87.6900, type: 'rescue' },
  "Trader Joe's": { lat: 41.9200, lng: -87.6600, type: 'rescue' },
  'Target': { lat: 41.9180, lng: -87.6690, type: 'rescue' },
  'Fresh Thyme': { lat: 41.9340, lng: -87.6640, type: 'rescue' },
  'Walmart': { lat: 41.8860, lng: -87.7440, type: 'rescue' },

  // Food suppliers & organizations
  'Local Foods': { lat: 41.7618, lng: -87.7555, type: 'rescue', address: '7424 S Lockwood Ave' },
  'Imperfect': { lat: 41.9175, lng: -87.8978, type: 'rescue', address: '575 Northwest Ave, Northlake' },
  'Sysco': { lat: 41.8470, lng: -87.7370, type: 'rescue' },
  'Cold Chain': { lat: 41.8700, lng: -87.7200, type: 'rescue' },
  'Sharing Excess': { lat: 41.8800, lng: -87.6600, type: 'rescue' },
  "What's Good Food": { lat: 41.8900, lng: -87.6700, type: 'rescue' },
  'Farm Link Project': { lat: 41.8850, lng: -87.6500, type: 'rescue' },
  'Produce Market': { lat: 41.8400, lng: -87.6500, type: 'rescue' },
  'CNO Financial': { lat: 41.8850, lng: -87.6350, type: 'rescue' },

  // Farmers markets
  'Green City Market': { lat: 41.9115, lng: -87.6345, type: 'rescue', address: '1817 N Clark St' },
  'Logan Square Farmers Market': { lat: 41.9240, lng: -87.7090, type: 'rescue', address: '3107 W Logan Blvd' },
  'Division Street Farmers Market': { lat: 41.9030, lng: -87.6730, type: 'rescue' },
  'South Loop Farmers Market': { lat: 41.8580, lng: -87.6270, type: 'rescue' },

  // Churches & community centers
  'San Lucas': { lat: 41.9100, lng: -87.6980, type: 'rescue', address: '2914 W North Ave' },
  'Uptown Baptist Church': { lat: 41.9660, lng: -87.6560, type: 'rescue' },
  'Irving Park Food Pantry': { lat: 41.9550, lng: -87.7233, type: 'rescue', address: '4256 N Ridgeway Ave' },
  'New Life GAP': { lat: 41.9620, lng: -87.7250, type: 'rescue', address: '4540 N Hamlin Ave' },
  'Friendship Center': { lat: 41.9500, lng: -87.6800, type: 'rescue' },
  'Global Refugee Farm': { lat: 41.9700, lng: -87.7400, type: 'rescue' },
  'Humboldt Health': { lat: 41.9020, lng: -87.7170, type: 'rescue' },
  'Joined Hands': { lat: 41.8900, lng: -87.7000, type: 'rescue' },

  // Events
  'Lollapalooza': { lat: 41.8745, lng: -87.6200, type: 'rescue', address: 'Grant Park' },
  'MSI': { lat: 41.7906, lng: -87.5831, type: 'rescue', address: 'Museum of Science and Industry' },
  '827 S Pulaski': { lat: 41.8710, lng: -87.7260, type: 'rescue', address: '827 S Pulaski Rd' },

  // ============ DISTRIBUTION / DROP-OFF LOCATIONS ============
  'Above & Beyond': { lat: 41.8770, lng: -87.7260, type: 'distribution', address: '817 S Pulaski Rd' },
  'Ama': { lat: 41.8550, lng: -87.6700, type: 'distribution' },
  'Avondale Mutual Aid': { lat: 41.9390, lng: -87.7110, type: 'distribution' },
  'BKMA': { lat: 41.9200, lng: -87.7100, type: 'distribution' }, // Bucktown-Koz Mutual Aid
  'BSA': { lat: 41.8500, lng: -87.6900, type: 'distribution' },
  'BYP': { lat: 41.8800, lng: -87.6400, type: 'distribution' },
  'Bill H': { lat: 41.9000, lng: -87.6800, type: 'distribution' },
  'Bryn Mawr Warming Center': { lat: 41.9830, lng: -87.6590, type: 'distribution' },
  'Casa al Fatiha': { lat: 41.8650, lng: -87.7100, type: 'distribution' },
  'D10 Precinct': { lat: 41.8750, lng: -87.7400, type: 'distribution' },
  'DPG': { lat: 41.8800, lng: -87.6600, type: 'distribution' },
  'District 7': { lat: 41.8700, lng: -87.7200, type: 'distribution' },
  'EMAN': { lat: 41.9400, lng: -87.6700, type: 'distribution' },
  'East Garfield': { lat: 41.8820, lng: -87.7050, type: 'distribution' },
  'FNB': { lat: 41.8900, lng: -87.6650, type: 'distribution' }, // Food Not Bombs
  'Humble Hearts': { lat: 41.8700, lng: -87.6900, type: 'distribution' },
  'Iman': { lat: 41.7700, lng: -87.6400, type: 'distribution' },
  'Just Roots': { lat: 41.9100, lng: -87.7050, type: 'distribution' },
  'Kostner Aldi': { lat: 41.9074, lng: -87.7350, type: 'distribution' },
  'LSRSN': { lat: 41.9300, lng: -87.7100, type: 'distribution' },
  'LV Free Store': { lat: 41.9200, lng: -87.6800, type: 'distribution' },
  'Love Fridge': { lat: 41.9100, lng: -87.6850, type: 'distribution' },
  'Marillac': { lat: 41.8850, lng: -87.7200, type: 'distribution' },
  'Migrant Centers': { lat: 41.8780, lng: -87.6290, type: 'distribution' },
  'NA4J': { lat: 41.8900, lng: -87.7150, type: 'distribution' },
  'NSSN': { lat: 41.9700, lng: -87.6600, type: 'distribution' },
  'NWMA': { lat: 41.9500, lng: -87.7500, type: 'distribution' },
  'New Hope': { lat: 41.9300, lng: -87.7200, type: 'distribution' },
  'Nuevos Vecinos': { lat: 41.8500, lng: -87.6800, type: 'distribution' },
  'OWMCL': { lat: 41.8600, lng: -87.7000, type: 'distribution' },
  'PSN': { lat: 41.8700, lng: -87.6700, type: 'distribution' },
  'Pilsen': { lat: 41.8560, lng: -87.6680, type: 'distribution' },
  'Pilsen Food Pantry': { lat: 41.8540, lng: -87.6650, type: 'distribution' },
  'Pilsen Free Store': { lat: 41.8530, lng: -87.6640, type: 'distribution' },
  'Port Ministries': { lat: 41.8350, lng: -87.6700, type: 'distribution' },
  'RCC': { lat: 41.8850, lng: -87.6850, type: 'distribution' },
  'RP FNB': { lat: 41.9700, lng: -87.6700, type: 'distribution' }, // Rogers Park FNB
  'SSMA': { lat: 41.8400, lng: -87.6300, type: 'distribution' },
  'SWC': { lat: 41.8900, lng: -87.7000, type: 'distribution' },
  'Sweet Water Foundation': { lat: 41.8100, lng: -87.6200, type: 'distribution' },
  'Task Force Chicago': { lat: 41.8700, lng: -87.6500, type: 'distribution' },
  'Todo Para Todos': { lat: 41.8550, lng: -87.6750, type: 'distribution' },
  'UKV': { lat: 41.9500, lng: -87.6900, type: 'distribution' },
  'United Neighbors': { lat: 41.8650, lng: -87.6600, type: 'distribution' },
  'WSMA': { lat: 41.8800, lng: -87.7500, type: 'distribution' },
  'Woodlawn Distro': { lat: 41.7800, lng: -87.6000, type: 'distribution' },
  'West Suburbs Community Pantry': { lat: 41.8300, lng: -87.8200, type: 'distribution' },
  'Getting Grown Collective': { lat: 41.7900, lng: -87.6500, type: 'distribution' },
}

export default LOCATIONS
