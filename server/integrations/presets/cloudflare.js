// Complete Cloudflare data center IATA code to city mapping
// Source: https://github.com/LufsX/Cloudflare-Data-Center-IATA-Code-list
const COLO_MAP = {
  'AAE': 'Annaba', 'ABJ': 'Abidjan', 'ABQ': 'Albuquerque', 'ACC': 'Accra', 'ADB': 'Izmir',
  'ADD': 'Addis Ababa', 'ADL': 'Adelaide', 'AGR': 'Agra', 'AKL': 'Auckland', 'AKX': 'Aktobe',
  'ALA': 'Almaty', 'ALG': 'Algiers', 'AMD': 'Ahmedabad', 'AMM': 'Amman', 'AMS': 'Amsterdam',
  'ANC': 'Anchorage', 'ARI': 'Arica', 'ARN': 'Stockholm', 'ARU': 'Aracatuba', 'ASK': 'Yamoussoukro',
  'ASU': 'Asunción', 'ATH': 'Athens', 'ATL': 'Atlanta', 'AUS': 'Austin', 'BAH': 'Manama',
  'BAQ': 'Barranquilla', 'BBI': 'Bhubaneswar', 'BCN': 'Barcelona', 'BEG': 'Belgrade', 'BEL': 'Belém',
  'BEY': 'Beirut', 'BGI': 'Bridgetown', 'BGR': 'Bangor', 'BGW': 'Baghdad', 'BHY': 'Beihai',
  'BKK': 'Bangkok', 'BLR': 'Bangalore', 'BNA': 'Nashville', 'BNE': 'Brisbane', 'BNU': 'Blumenau',
  'BOD': 'Bordeaux', 'BOG': 'Bogota', 'BOM': 'Mumbai', 'BOS': 'Boston', 'BRU': 'Brussels',
  'BSB': 'Brasilia', 'BSR': 'Basra', 'BTS': 'Bratislava', 'BUD': 'Budapest', 'BUF': 'Buffalo',
  'BWN': 'Bandar Seri Begawan', 'CAI': 'Cairo', 'CAN': 'Guangzhou', 'CAW': 'Campos dos Goytacazes',
  'CBR': 'Canberra', 'CCP': 'Concepción', 'CCU': 'Kolkata', 'CDG': 'Paris', 'CEB': 'Cebu',
  'CFC': 'Cacador', 'CGB': 'Cuiaba', 'CGD': 'Changde', 'CGK': 'Jakarta', 'CGO': 'Zhengzhou',
  'CGP': 'Chittagong', 'CGY': 'Cagayan de Oro', 'CHC': 'Christchurch', 'CJB': 'Coimbatore',
  'CKG': 'Chongqing', 'CLE': 'Cleveland', 'CLO': 'Cali', 'CLT': 'Charlotte', 'CMB': 'Colombo',
  'CMH': 'Columbus', 'CNF': 'Belo Horizonte', 'CNN': 'Kannur', 'CNX': 'Chiang Mai', 'COK': 'Kochi',
  'COR': 'Córdoba', 'CPH': 'Copenhagen', 'CPT': 'Cape Town', 'CRK': 'Tarlac City', 'CSX': 'Changsha',
  'CTU': 'Chengdu', 'CWB': 'Curitiba', 'CZL': 'Constantine', 'CZX': 'Changzhou', 'DAC': 'Dhaka',
  'DAD': 'Da Nang', 'DAR': 'Dar es Salaam', 'DEL': 'New Delhi', 'DEN': 'Denver', 'DFW': 'Dallas',
  'DKR': 'Dakar', 'DLC': 'Dalian', 'DME': 'Moscow', 'DMM': 'Dammam', 'DOH': 'Doha',
  'DPS': 'Denpasar', 'DTW': 'Detroit', 'DUB': 'Dublin', 'DUR': 'Durban', 'DUS': 'Düsseldorf',
  'DXB': 'Dubai', 'EBB': 'Kampala', 'EBL': 'Erbil', 'EDI': 'Edinburgh', 'EVN': 'Yerevan',
  'EWR': 'Newark', 'EZE': 'Buenos Aires', 'FCO': 'Rome', 'FIH': 'Kinshasa', 'FLN': 'Florianopolis',
  'FOC': 'Fuzhou', 'FOR': 'Fortaleza', 'FRA': 'Frankfurt', 'FRU': 'Bishkek', 'FSD': 'Sioux Falls',
  'FUK': 'Fukuoka', 'FUO': 'Foshan', 'GBE': 'Gaborone', 'GDL': 'Guadalajara', 'GEO': 'Georgetown',
  'GIG': 'Rio de Janeiro', 'GND': "St. George's", 'GOT': 'Gothenburg', 'GRU': 'São Paulo',
  'GUA': 'Guatemala City', 'GUM': 'Hagatna', 'GVA': 'Geneva', 'GYD': 'Baku', 'GYE': 'Guayaquil',
  'GYN': 'Goiania', 'HAK': 'Chengmai', 'HAM': 'Hamburg', 'HAN': 'Hanoi', 'HBA': 'Hobart',
  'HEL': 'Helsinki', 'HFA': 'Haifa', 'HFE': 'Huainan', 'HGH': 'Shaoxing', 'HKG': 'Hong Kong',
  'HNL': 'Honolulu', 'HRE': 'Harare', 'HYD': 'Hyderabad', 'HYN': 'Taizhou', 'IAD': 'Ashburn',
  'IAH': 'Houston', 'ICN': 'Seoul', 'IND': 'Indianapolis', 'ISB': 'Islamabad', 'IST': 'Istanbul',
  'ISU': 'Sulaymaniyah', 'ITJ': 'Itajai', 'IXC': 'Chandigarh', 'JAX': 'Jacksonville',
  'JDO': 'Juazeiro do Norte', 'JED': 'Jeddah', 'JHB': 'Johor Bahru', 'JIB': 'Djibouti City',
  'JNB': 'Johannesburg', 'JOG': 'Yogyakarta', 'JOI': 'Joinville', 'JSR': 'Jashore',
  'JXG': 'Jiaxing', 'KBP': 'Kyiv', 'KCH': 'Kuching', 'KEF': 'Reykjavík', 'KGL': 'Kigali',
  'KHH': 'Kaohsiung City', 'KHI': 'Karachi', 'KHN': 'Nanchang', 'KIN': 'Kingston',
  'KIV': 'Chișinău', 'KIX': 'Osaka', 'KJA': 'Krasnoyarsk', 'KMG': 'Kunming', 'KNU': 'Kanpur',
  'KTM': 'Kathmandu', 'KUL': 'Kuala Lumpur', 'KWE': 'Guiyang', 'KWI': 'Kuwait City',
  'LAD': 'Luanda', 'LAS': 'Las Vegas', 'LAX': 'Los Angeles', 'LCA': 'Nicosia', 'LED': 'Saint Petersburg',
  'LHE': 'Lahore', 'LHR': 'London', 'LHW': 'Lanzhou', 'LIM': 'Lima', 'LIS': 'Lisbon',
  'LLK': 'Astara', 'LLW': 'Lilongwe', 'LOS': 'Lagos', 'LPB': 'La Paz', 'LUN': 'Lusaka',
  'LUX': 'Luxembourg City', 'LYS': 'Lyon', 'MAA': 'Chennai', 'MAD': 'Madrid', 'MAN': 'Manchester',
  'MAO': 'Manaus', 'MBA': 'Mombasa', 'MCI': 'Kansas City', 'MCT': 'Muscat', 'MDE': 'Medellín',
  'MEL': 'Melbourne', 'MEM': 'Memphis', 'MEX': 'Mexico City', 'MFE': 'McAllen', 'MFM': 'Macau',
  'MIA': 'Miami', 'MLA': 'Valletta', 'MLE': 'Male', 'MLG': 'Malang', 'MNL': 'Manila',
  'MPM': 'Maputo', 'MRS': 'Marseille', 'MRU': 'Port Louis', 'MSP': 'Minneapolis', 'MSQ': 'Minsk',
  'MUC': 'Munich', 'MXP': 'Milan', 'NAG': 'Nagpur', 'NBO': 'Nairobi', 'NJF': 'Najaf',
  'NNG': 'Nanning', 'NOU': 'Noumea', 'NQN': 'Neuquen', 'NQZ': 'Astana', 'NRT': 'Tokyo',
  'NVT': 'Timbo', 'OKA': 'Naha', 'OKC': 'Oklahoma City', 'OMA': 'Omaha', 'ORD': 'Chicago',
  'ORF': 'Norfolk', 'ORK': 'Cork', 'ORN': 'Oran', 'OSL': 'Oslo', 'OTP': 'Bucharest',
  'OUA': 'Ouagadougou', 'PAT': 'Patna', 'PBH': 'Thimphu', 'PBM': 'Paramaribo', 'PDX': 'Portland',
  'PER': 'Perth', 'PHL': 'Philadelphia', 'PHX': 'Phoenix', 'PIT': 'Pittsburgh', 'PKX': 'Langfang',
  'PMO': 'Palermo', 'PMW': 'Palmas', 'PNH': 'Phnom Penh', 'POA': 'Porto Alegre',
  'POS': 'Port of Spain', 'PPT': 'Tahiti', 'PRG': 'Prague', 'PTY': 'Panama City', 'QRO': 'Queretaro',
  'QWJ': 'Americana', 'RAO': 'Ribeirao Preto', 'RDU': 'Durham', 'REC': 'Recife', 'RIC': 'Richmond',
  'RIX': 'Riga', 'RUH': 'Riyadh', 'RUN': 'Réunion', 'SAN': 'San Diego', 'SAP': 'San Pedro Sula',
  'SAT': 'San Antonio', 'SCL': 'Santiago', 'SDQ': 'Santo Domingo', 'SEA': 'Seattle',
  'SFO': 'San Francisco', 'SGN': 'Ho Chi Minh City', 'SHA': 'Shanghai', 'SIN': 'Singapore',
  'SJC': 'San Jose', 'SJK': 'São José dos Campos', 'SJO': 'San José', 'SJP': 'São José do Rio Preto',
  'SJU': 'San Juan', 'SJW': 'Shijiazhuang', 'SKG': 'Thessaloniki', 'SKP': 'Skopje',
  'SLC': 'Salt Lake City', 'SMF': 'Sacramento', 'SOD': 'Sorocaba', 'SOF': 'Sofia', 'SSA': 'Salvador',
  'STI': 'Santiago de los Caballeros', 'STL': 'St. Louis', 'STR': 'Stuttgart', 'SUV': 'Suva',
  'SVX': 'Yekaterinburg', 'SYD': 'Sydney', 'SZX': 'Shenzhen', 'TAO': 'Qingdao', 'TAS': 'Tashkent',
  'TBS': 'Tbilisi', 'TEN': 'Tongren', 'TGU': 'Tegucigalpa', 'TIA': 'Tirana', 'TLH': 'Tallahassee',
  'TLL': 'Tallinn', 'TLV': 'Tel Aviv', 'TNA': 'Zibo', 'TNR': 'Antananarivo', 'TPA': 'Tampa',
  'TPE': 'Taipei', 'TSN': 'Tianjin', 'TUN': 'Tunis', 'TXL': 'Berlin', 'TYN': 'Yangquan',
  'UDI': 'Uberlandia', 'UIO': 'Quito', 'ULN': 'Ulaanbaatar', 'URT': 'Surat Thani',
  'VCP': 'Campinas', 'VIE': 'Vienna', 'VIX': 'Vitoria', 'VNO': 'Vilnius', 'VTE': 'Vientiane',
  'WAW': 'Warsaw', 'WDH': 'Windhoek', 'WHU': 'Wuhu', 'WRO': 'Wroclaw', 'XAP': 'Chapeco',
  'XFN': 'Xiangyang', 'XIY': 'Baoji', 'XNH': 'Nasiriyah', 'XNN': 'Xining', 'YHZ': 'Halifax',
  'YOW': 'Ottawa', 'YUL': 'Montréal', 'YVR': 'Vancouver', 'YWG': 'Winnipeg', 'YXE': 'Saskatoon',
  'YYC': 'Calgary', 'YYZ': 'Toronto', 'ZAG': 'Zagreb', 'ZDM': 'Ramallah', 'ZGN': 'Zhongshan',
  'ZRH': 'Zurich',
};

export default {
  name: 'Cloudflare Tunnels',
  icon: 'cloudflare',
  description: 'Secure tunnels to expose local services',
  auth: 'bearer',
  endpoint: '/client/v4/accounts/{account_id}/cfd_tunnel?is_deleted=false',
  testEndpoint: '/client/v4/user/tokens/verify',
  urlParams: [
    { key: 'account_id', label: 'Account ID', placeholder: 'Your Cloudflare Account ID' },
  ],
  fields: [],
  structuredTransform: (raw) => {
    const tunnels = raw?.result || [];
    const healthy = tunnels.filter(t => t.status === 'healthy').length;
    const total = tunnels.length;
    const allConns = tunnels.flatMap(t => t.connections || []);
    const edges = [...new Set(allConns.map(c => {
      const code = (c.colo_name || '').replace(/[0-9]/g, '').toUpperCase();
      return COLO_MAP[code] || c.colo_name;
    }))].join(', ') || '—';
    const status = total === 0 ? 'No tunnels' : healthy === total ? 'Healthy' : `${healthy}/${total} healthy`;
    const fields = {
      'Status': status,
      'Conns': String(allConns.length),
      'Edge': edges,
    };
    return { fields };
  },
  envKeys: {
    url: 'CLOUDFLARE_URL',
    token: 'CLOUDFLARE_TOKEN',
  },
  defaultUrl: 'https://api.cloudflare.com',
};
