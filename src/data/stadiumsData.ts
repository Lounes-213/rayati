/**
 * Algerian Stadiums and Match metadata extracted directly from Digiticket.dz
 */

export interface AlgerianStadium {
  id: string;
  name: string;
  city: string;
  capacity: number;
  year: number;
  status: string;
  fileImageId?: string;
  fallbackImage: string;
}

export interface UpcomingMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  date: string;
  stadium: string;
  price: string;
}

export const ALGERIAN_STADIUMS: AlgerianStadium[] = [
  {
    id: 'ali-la-pointe',
    name: 'ملعب علي عمار المدعو علي لابوانت',
    city: 'الدويرة، الجزائر العاصمة',
    capacity: 40000,
    year: 2024,
    status: 'جديد ودولي',
    fileImageId: '9967d241-0443-4d2c-b6b3-f90c286f18e4',
    fallbackImage: '/images/digiticket_og.png',
  },
  {
    id: 'hocine-ait-ahmed',
    name: 'ملعب حسين آيت أحمد',
    city: 'تيزي وزو',
    capacity: 50766,
    year: 2024,
    status: 'جديد ومطابق للفيفا',
    fileImageId: 'a70890ee-8a27-44b2-a9d4-c9338635be22',
    fallbackImage: '/images/stadium_tifo_night.png',
  },
  {
    id: '5-juillet',
    name: 'ملعب 5 جويلية 1962 الأولمبي',
    city: 'الجزائر العاصمة',
    capacity: 64000,
    year: 1972,
    status: 'تاريخي ومعتمد',
    fileImageId: '7b589ee8-e44c-4b00-94f0-2ead9d314917',
    fallbackImage: '/images/stadium_tifo_night.png',
  },
  {
    id: 'miloud-hadefi',
    name: 'ملعب ميلود هدفي',
    city: 'وهران',
    capacity: 50000,
    year: 2021,
    status: 'أولمبي حديث',
    fileImageId: 'ace76f1b-a921-4d05-9dff-77aee408e9ad',
    fallbackImage: '/images/digiticket_og.png',
  },
  {
    id: 'nelson-mandela',
    name: 'ملعب نيلسون مانديلا',
    city: 'براقي، الجزائر العاصمة',
    capacity: 40784,
    year: 2023,
    status: 'مغطى بالكامل',
    fallbackImage: '/images/stadium_tifo_night.png',
  },
  {
    id: '19-mai',
    name: 'ملعب 19 ماي 1956',
    city: 'عنابة',
    capacity: 56000,
    year: 1987,
    status: 'محدث ومعتمد',
    fileImageId: 'aaca345b-d3b1-4ac9-8838-9ac7f742b88c',
    fallbackImage: '/images/digiticket_og.png',
  },
  {
    id: 'chahid-hamlaoui',
    name: 'ملعب الشهيد حملاوي',
    city: 'قسنطينة',
    capacity: 22986,
    year: 1973,
    status: 'محدث ومعتمد',
    fileImageId: '2dfeffb5-3987-4bee-b4ad-839efb7cfadc',
    fallbackImage: '/images/digiticket_og.png',
  },
];

export const UPCOMING_MATCHES: UpcomingMatch[] = [
  {
    id: 'm1',
    homeTeam: 'شبيبة القبائل',
    awayTeam: 'مولودية الجزائر',
    competition: 'الرابطة المحترفة الأولى موبيليس',
    date: 'الجمعة · 17:00',
    stadium: 'ملعب حسين آيت أحمد - تيزي وزو',
    price: '500 دج',
  },
  {
    id: 'm2',
    homeTeam: 'مولودية وهران',
    awayTeam: 'اتحاد خنشلة',
    competition: 'الرابطة المحترفة الأولى موبيليس',
    date: 'السبت · 18:00',
    stadium: 'ملعب ميلود هدفي - وهران',
    price: '400 دج',
  },
  {
    id: 'm3',
    homeTeam: 'شباب قسنطينة',
    awayTeam: 'اتحاد بسكرة',
    competition: 'الرابطة المحترفة الأولى موبيليس',
    date: 'الأحد · 16:00',
    stadium: 'ملعب الشهيد حملاوي - قسنطينة',
    price: '300 دج',
  },
];
